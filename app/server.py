"""Local server: watches Windows media, fetches lyrics, streams it all to the UI over a WebSocket."""
from __future__ import annotations

import asyncio
import json
import logging
import time
from pathlib import Path

import aiohttp
from aiohttp import web

from .lyrics import LyricsProvider, itunes_artwork
from .media import MediaWatcher, NowPlaying
from .paths import DATA, WEB

log = logging.getLogger("server")
WEB_DIR = WEB
POLL_INTERVAL = 0.25
STATE_HEARTBEAT = 1.0


class Hub:
    def __init__(self) -> None:
        self.media = MediaWatcher()
        self.lyrics = LyricsProvider()
        self.clients: set[web.WebSocketResponse] = set()
        self.main_clients: set[web.WebSocketResponse] = set()
        self.track_msg: dict | None = None
        self.lyrics_msg: dict | None = None
        self.state_msg: dict | None = None
        self.art: dict[str, bytes] = {}
        self._last: NowPlaying | None = None
        self._last_sent = 0.0
        self._lyrics_task: asyncio.Task | None = None
        self._http: aiohttp.ClientSession | None = None
        # settings shared by every window (so all screens look the same)
        self.settings_file = DATA / "settings.json"
        try:
            self.settings: dict = json.loads(self.settings_file.read_text("utf-8"))
        except Exception:
            self.settings = {}
        self.on_screens = None      # callback(action) set by main.py
        self.screen_count = lambda: 1

    def save_settings(self) -> None:
        try:
            self.settings_file.write_text(json.dumps(self.settings), "utf-8")
        except Exception as e:
            log.warning("couldn't save settings: %s", e)

    async def http(self) -> aiohttp.ClientSession:
        if self._http is None or self._http.closed:
            self._http = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10))
        return self._http

    async def broadcast(self, msg: dict) -> None:
        data = json.dumps(msg)
        dead = []
        for ws in self.clients:
            try:
                await ws.send_str(data)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.clients.discard(ws)

    async def _load_track_extras(self, np: NowPlaying) -> None:
        tid = np.track_id
        if not np.art:
            art = await itunes_artwork(await self.http(), np.title, np.artist)
            if art and self.track_msg and self.track_msg["id"] == tid:
                self.art[tid] = art
                self.track_msg["art"] = f"/art/{tid}"
                await self.broadcast(self.track_msg)
        try:
            lyr = await self.lyrics.get(tid, np.title, np.artist, np.album, np.duration)
        except Exception as e:
            log.warning("lyrics lookup failed: %s", e)
            lyr = {"status": "error", "lines": []}
        if self.track_msg and self.track_msg["id"] == tid:
            self.lyrics_msg = {"type": "lyrics", "id": tid, **lyr}
            await self.broadcast(self.lyrics_msg)
            log.info("lyrics: %s (%d lines) for %s - %s", lyr["status"], len(lyr["lines"]), np.artist, np.title)

    async def tick(self) -> None:
        np = await self.media.poll()
        prev = self._last
        self._last = np
        now = time.time()

        if not np.has_track:
            if prev is None or prev.has_track:
                self.track_msg = self.lyrics_msg = self.state_msg = None
                await self.broadcast({"type": "idle"})
            return

        tid = np.track_id
        if prev is None or prev.track_id != tid:
            if np.art:
                self.art[tid] = np.art
                if len(self.art) > 32:
                    self.art.pop(next(iter(self.art)))
            self.track_msg = {
                "type": "track", "id": tid, "title": np.title, "artist": np.artist,
                "album": np.album, "duration": np.duration, "app": np.app,
                "art": f"/art/{tid}" if np.art else None,
            }
            self.lyrics_msg = {"type": "lyrics", "id": tid, "status": "loading", "lines": []}
            await self.broadcast(self.track_msg)
            await self.broadcast(self.lyrics_msg)
            if self._lyrics_task and not self._lyrics_task.done():
                self._lyrics_task.cancel()
            self._lyrics_task = asyncio.create_task(self._load_track_extras(np))
            log.info("now playing: %s - %s [%s]", np.artist, np.title, np.app)

        changed = (
            prev is None or prev.track_id != tid or prev.playing != np.playing
            or abs(np.duration - prev.duration) > 0.5
        )
        if not changed and prev is not None:
            expected = prev.position + ((np.stamp - prev.stamp) if prev.playing else 0)
            changed = abs(np.position - expected) > 1.0  # seek
        if changed or now - self._last_sent >= STATE_HEARTBEAT:
            self.state_msg = {
                "type": "state", "id": tid, "position": np.position, "stamp": np.stamp,
                "playing": np.playing, "duration": np.duration,
            }
            self._last_sent = now
            await self.broadcast(self.state_msg)

    async def run(self) -> None:
        while True:
            try:
                await self.tick()
            except asyncio.CancelledError:
                raise
            except Exception as e:
                log.warning("poll error: %s", e)
                await asyncio.sleep(1)
            await asyncio.sleep(POLL_INTERVAL)


async def ws_handler(request: web.Request) -> web.WebSocketResponse:
    hub: Hub = request.app["hub"]
    ws = web.WebSocketResponse(heartbeat=20)
    await ws.prepare(request)
    hub.clients.add(ws)
    is_main = "screen" not in request.query
    if is_main:
        hub.main_clients.add(ws)
    await ws.send_str(json.dumps({"type": "hello", "screens": hub.screen_count(), "settings": hub.settings}))
    for m in (hub.track_msg, hub.lyrics_msg, hub.state_msg):
        if m:
            await ws.send_str(json.dumps(m))
    if hub.track_msg is None:
        await ws.send_str(json.dumps({"type": "idle"}))
    try:
        async for msg in ws:
            if msg.type == aiohttp.WSMsgType.TEXT:
                try:
                    data = json.loads(msg.data)
                except ValueError:
                    continue
                kind = data.get("type")
                if kind == "control":
                    try:
                        await hub.media.control(data.get("action", ""))
                    except Exception as e:
                        log.warning("control failed: %s", e)
                elif kind == "settings" and isinstance(data.get("data"), dict):
                    hub.settings = data["data"]
                    hub.save_settings()
                    out = json.dumps({"type": "settings", "data": hub.settings})
                    for other in list(hub.clients):
                        if other is not ws:
                            try:
                                await other.send_str(out)
                            except Exception:
                                hub.clients.discard(other)
                elif kind == "screens" and hub.on_screens:
                    try:
                        await asyncio.get_running_loop().run_in_executor(None, hub.on_screens, data.get("action"))
                    except Exception as e:
                        log.warning("screens failed: %s", e)
    finally:
        hub.clients.discard(ws)
        hub.main_clients.discard(ws)
    return ws


async def art_handler(request: web.Request) -> web.Response:
    hub: Hub = request.app["hub"]
    data = hub.art.get(request.match_info["tid"])
    if not data:
        raise web.HTTPNotFound()
    ctype = "image/png" if data[:8] == b"\x89PNG\r\n\x1a\n" else "image/jpeg"
    return web.Response(body=data, content_type=ctype, headers={"Cache-Control": "max-age=3600"})


async def index_handler(request: web.Request) -> web.FileResponse:
    return web.FileResponse(WEB_DIR / "index.html", headers={"Cache-Control": "no-cache"})


@web.middleware
async def no_cache(request: web.Request, handler):
    resp = await handler(request)
    if not request.path.startswith("/art/"):
        resp.headers["Cache-Control"] = "no-cache"  # always pick up updated UI files
    return resp


def build_app() -> web.Application:
    app = web.Application(middlewares=[no_cache])
    hub = Hub()
    app["hub"] = hub

    async def on_start(app):
        app["poller"] = asyncio.create_task(hub.run())

    async def on_stop(app):
        app["poller"].cancel()
        await hub.lyrics.close()
        if hub._http:
            await hub._http.close()

    app.on_startup.append(on_start)
    app.on_cleanup.append(on_stop)
    app.router.add_get("/__ping", lambda r: web.Response(text="animated-lyrics"))
    app.router.add_get("/", index_handler)
    app.router.add_get("/ws", ws_handler)
    app.router.add_get("/art/{tid}", art_handler)
    app.router.add_static("/", WEB_DIR, append_version=False)
    return app
