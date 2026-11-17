"""Reads "what's playing" from Windows' global media controls (SMTC).

Works with anything that shows up in the Windows volume / media flyout:
Spotify, Apple Music, browsers (YouTube, YT Music, SoundCloud...), foobar, etc.
"""
from __future__ import annotations

import asyncio
import datetime as dt
import hashlib
import logging
from dataclasses import dataclass, field

from winrt.windows.media.control import (
    GlobalSystemMediaTransportControlsSessionManager as SessionManager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus as PlaybackStatus,
)
from winrt.windows.storage.streams import Buffer, DataReader, InputStreamOptions

log = logging.getLogger("media")

# Players we'd rather follow when several apps have sessions open.
PREFERRED_APPS = ("spotify", "applemusic", "apple music", "itunes", "tidal", "deezer", "amazon music")


@dataclass
class NowPlaying:
    app: str = ""
    title: str = ""
    artist: str = ""
    album: str = ""
    duration: float = 0.0          # seconds (0 if unknown)
    position: float = 0.0          # seconds, extrapolated to `stamp`
    stamp: float = 0.0             # unix seconds when `position` was true
    playing: bool = False
    art: bytes | None = field(default=None, repr=False)

    @property
    def track_id(self) -> str:
        key = f"{self.app}|{self.title}|{self.artist}|{self.album}".lower()
        return hashlib.sha1(key.encode()).hexdigest()[:16]

    @property
    def has_track(self) -> bool:
        return bool(self.title)


async def _read_thumbnail(ref) -> bytes | None:
    if ref is None:
        return None
    try:
        stream = await ref.open_read_async()
        size = int(stream.size)
        if size <= 0:
            return None
        buf = Buffer(size)
        await stream.read_async(buf, size, InputStreamOptions.READ_AHEAD)
        try:
            return bytes(memoryview(buf))
        except TypeError:
            reader = DataReader.from_buffer(buf)
            out = bytearray(buf.length)
            reader.read_bytes(out)
            return bytes(out)
    except Exception as e:  # thumbnails are best-effort
        log.debug("thumbnail read failed: %s", e)
        return None


class MediaWatcher:
    def __init__(self) -> None:
        self._mgr: SessionManager | None = None
        self._art_cache: dict[str, bytes | None] = {}

    async def _manager(self) -> SessionManager:
        if self._mgr is None:
            self._mgr = await SessionManager.request_async()
        return self._mgr

    def _pick_session(self, mgr: SessionManager):
        sessions = list(mgr.get_sessions())
        if not sessions:
            return None

        def score(s) -> tuple:
            app = (s.source_app_user_model_id or "").lower()
            try:
                playing = s.get_playback_info().playback_status == PlaybackStatus.PLAYING
            except Exception:
                playing = False
            preferred = any(p in app for p in PREFERRED_APPS)
            return (playing, preferred)

        best = max(sessions, key=score)
        # If nothing is playing, stick with what Windows thinks is current.
        if not score(best)[0]:
            cur = mgr.get_current_session()
            if cur is not None:
                return cur
        return best

    async def poll(self) -> NowPlaying:
        mgr = await self._manager()
        session = self._pick_session(mgr)
        np = NowPlaying(stamp=dt.datetime.now(dt.timezone.utc).timestamp())
        if session is None:
            return np

        np.app = session.source_app_user_model_id or ""
        props = await session.try_get_media_properties_async()
        np.title = (props.title or "").strip()
        np.artist = (props.artist or props.album_artist or "").strip()
        np.album = (props.album_title or "").strip()

        info = session.get_playback_info()
        np.playing = info.playback_status == PlaybackStatus.PLAYING

        tl = session.get_timeline_properties()
        end = tl.end_time.total_seconds() - tl.start_time.total_seconds()
        np.duration = max(0.0, end)
        pos = tl.position.total_seconds()
        if np.playing and tl.last_updated_time is not None:
            try:
                updated = tl.last_updated_time.timestamp()
                if updated > 0:
                    pos += max(0.0, np.stamp - updated)
            except (OverflowError, OSError, ValueError):
                pass
        if np.duration:
            pos = min(pos, np.duration)
        np.position = max(0.0, pos)

        tid = np.track_id
        if tid not in self._art_cache:
            self._art_cache[tid] = await _read_thumbnail(props.thumbnail)
            if len(self._art_cache) > 64:
                self._art_cache.pop(next(iter(self._art_cache)))
        np.art = self._art_cache[tid]
        return np

    async def control(self, action: str) -> None:
        mgr = await self._manager()
        s = self._pick_session(mgr)
        if s is None:
            return
        if action == "toggle":
            await s.try_toggle_play_pause_async()
        elif action == "next":
            await s.try_skip_next_async()
        elif action == "prev":
            await s.try_skip_previous_async()


if __name__ == "__main__":
    async def _demo():
        w = MediaWatcher()
        while True:
            np = await w.poll()
            print(np, "art:", len(np.art) if np.art else None)
            await asyncio.sleep(1)

    asyncio.run(_demo())
