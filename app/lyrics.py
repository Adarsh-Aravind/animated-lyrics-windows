"""Synced lyrics lookup (LRCLIB) + LRC parsing, with a small on-disk cache."""
from __future__ import annotations

import json
import logging
import re
import urllib.parse
from pathlib import Path

import aiohttp

from .paths import DATA

log = logging.getLogger("lyrics")

LRCLIB = "https://lrclib.net/api"
HEADERS = {"User-Agent": "AnimatedLyrics/1.0 (personal desktop app)"}
CACHE_DIR = DATA / "lyrics"

_LINE_TAG = re.compile(r"\[(\d+):(\d+(?:[.:]\d+)?)\]")
_WORD_TAG = re.compile(r"<(\d+):(\d+(?:[.:]\d+)?)>")


def _secs(m: str, s: str) -> float:
    return int(m) * 60 + float(s.replace(":", "."))


def parse_lrc(text: str) -> list[dict]:
    """Return [{"t": start, "text": str, "words": [{"w": str, "t": float|None}]}] sorted by t.

    Supports plain LRC and "enhanced" LRC with <mm:ss.xx> per-word tags.
    """
    lines: list[dict] = []
    for raw in text.splitlines():
        tags = list(_LINE_TAG.finditer(raw))
        if not tags:
            continue
        body = raw[tags[-1].end():].strip()
        words: list[dict] = []
        if _WORD_TAG.search(body):
            parts = _WORD_TAG.split(body)
            # parts: [pre, m, s, chunk, m, s, chunk, ...]
            pre = parts[0].strip()
            if pre:
                words += [{"w": w, "t": None} for w in pre.split()]
            for i in range(1, len(parts), 3):
                t = _secs(parts[i], parts[i + 1])
                for j, w in enumerate(parts[i + 2].split()):
                    words.append({"w": w, "t": t if j == 0 else None})
            body = " ".join(w["w"] for w in words)
        else:
            words = [{"w": w, "t": None} for w in body.split()]
        for tag in tags:
            lines.append({"t": _secs(tag.group(1), tag.group(2)), "text": body, "words": [dict(w) for w in words]})
    lines.sort(key=lambda l: l["t"])
    return lines


_JUNK = re.compile(
    r"\s*[\(\[](?:official|lyric|lyrics|audio|video|visuali[sz]er|hd|hq|4k|explicit|clean|"
    r"remaster(?:ed)?|live|mv|m/v|color coded|slowed|sped|speed|nightcore|reverb|8d)[^\)\]]*[\)\]]",
    re.I,
)
_FEAT = re.compile(r"\s*[\(\[]?\s*(?:feat\.?|ft\.?|featuring|with)\s+[^\)\]]*[\)\]]?", re.I)
_DASH_SUFFIX = re.compile(r"\s+-\s+(?:.*remaster.*|.*version.*|.*edit.*|live.*|mono|stereo|from .*|.*slowed.*|.*sped.*|.*speed.*|.*nightcore.*|.*reverb.*)$", re.I)


def clean_title(title: str) -> str:
    t = _JUNK.sub("", title)
    t = _DASH_SUFFIX.sub("", t)
    t = _FEAT.sub("", t)
    return re.sub(r"\s{2,}", " ", t).strip(" -|")


def clean_artist(artist: str) -> str:
    a = re.sub(r"\s*-\s*Topic$", "", artist)
    a = re.sub(r"VEVO$", "", a, flags=re.I)
    a = re.split(r"\s*(?:,|&| x | feat\.? | ft\.? )\s*", a, maxsplit=1)[0]
    return a.strip()


def _squash(s: str) -> str:
    return re.sub(r"[^\w]+", "", s.lower())


def _norm(s: str) -> str:
    return re.sub(r"[^\w]+", " ", clean_title(s).lower()).strip()


def title_matches(found: str, wanted: str) -> bool:
    a, b = _norm(found), _norm(wanted)
    if not a or not b:
        return False
    if a in b or b in a:
        return True
    ta, tb = set(a.split()), set(b.split())
    return len(ta & tb) / max(1, min(len(ta), len(tb))) >= 0.6


def candidates(title: str, artist: str) -> list[tuple[str, str]]:
    """Guesses for (track, artist), best first. Handles 'Artist - Song' browser titles."""
    out: list[tuple[str, str]] = []
    t, a = clean_title(title), clean_artist(artist)
    if " - " in title:
        left, right = title.split(" - ", 1)
        split = (clean_title(right), clean_artist(left))
        channel = bool(re.search(r"(VEVO|- Topic)$", artist, re.I))
        sa, sl = _squash(a), _squash(left)
        if channel or (sa and (sa in sl or sl in sa)):
            out.append(split)  # YouTube style "Artist - Song": try that first
        out.append((t, a))
        out.append(split)
        out.append((clean_title(left), clean_artist(right)))
    else:
        out.append((t, a))
    seen, uniq = set(), []
    for c in out:
        if c[0] and c not in seen:
            seen.add(c)
            uniq.append(c)
    return uniq


class LyricsProvider:
    def __init__(self) -> None:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        self._session: aiohttp.ClientSession | None = None

    async def _http(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession(headers=HEADERS, timeout=aiohttp.ClientTimeout(total=12))
        return self._session

    async def close(self) -> None:
        if self._session:
            await self._session.close()

    async def _get_json(self, url: str):
        s = await self._http()
        async with s.get(url) as r:
            if r.status != 200:
                return None
            return await r.json(content_type=None)

    async def _lookup(self, title: str, artist: str, album: str, duration: float) -> dict | None:
        for track, art in candidates(title, artist):
            if art:
                q = {"track_name": track, "artist_name": art}
                if album:
                    q["album_name"] = album
                if duration:
                    q["duration"] = str(round(duration))
                try:
                    hit = await self._get_json(f"{LRCLIB}/get?{urllib.parse.urlencode(q)}")
                    if hit and (hit.get("syncedLyrics") or hit.get("plainLyrics") or hit.get("instrumental")):
                        return hit
                except Exception as e:
                    log.debug("lrclib get failed: %s", e)

            q = {"track_name": track}
            if art:
                q["artist_name"] = art
            try:
                results = await self._get_json(f"{LRCLIB}/search?{urllib.parse.urlencode(q)}") or []
            except Exception as e:
                log.debug("lrclib search failed: %s", e)
                results = []
            if not results and art:
                try:
                    results = await self._get_json(f"{LRCLIB}/search?{urllib.parse.urlencode({'q': f'{art} {track}'})}") or []
                except Exception:
                    results = []

            def rank(r):
                synced = bool(r.get("syncedLyrics"))
                dur_off = abs((r.get("duration") or 0) - duration) if duration else 0
                return (synced, -min(dur_off, 60))

            results = [r for r in results if (r.get("syncedLyrics") or r.get("plainLyrics") or r.get("instrumental"))
                       and title_matches(r.get("trackName") or "", track)]
            if duration:
                close = [r for r in results if abs((r.get("duration") or 0) - duration) <= 8]
                if not close:
                    # e.g. a music video with an intro: accept only if the artist clearly matches
                    al = art.lower()
                    close = [r for r in results if al and (al in (r.get("artistName") or "").lower()
                             or (r.get("artistName") or "").lower() in al)]
                results = close
            if results:
                return max(results, key=rank)
        return None

    async def get(self, track_id: str, title: str, artist: str, album: str, duration: float, force: bool = False) -> dict:
        cache = CACHE_DIR / f"{track_id}.json"
        if cache.exists() and not force:
            try:
                return json.loads(cache.read_text("utf-8"))
            except Exception:
                pass

        hit = await self._lookup(title, artist, album, duration)
        result: dict = {"status": "missing", "lines": [], "source": None}
        if hit:
            result["source"] = "lrclib"
            result["duration"] = hit.get("duration")
            if hit.get("instrumental"):
                result["status"] = "instrumental"
            elif hit.get("syncedLyrics"):
                lines = parse_lrc(hit["syncedLyrics"])
                result["status"] = "synced"
                result["wordSynced"] = any(w["t"] is not None for l in lines for w in l["words"])
                result["lines"] = lines
            elif hit.get("plainLyrics"):
                result["status"] = "plain"
                plain = [l.strip() for l in hit["plainLyrics"].splitlines() if l.strip()]
                result["lines"] = [{"t": None, "text": l, "words": [{"w": w, "t": None} for w in l.split()]} for l in plain]

        if result["status"] != "missing":
            try:
                cache.write_text(json.dumps(result), "utf-8")
            except Exception:
                pass
        return result


async def itunes_artwork(session: aiohttp.ClientSession, title: str, artist: str) -> bytes | None:
    """Fallback cover art when the player doesn't expose one (common for browsers)."""
    for track, art in candidates(title, artist)[:2]:
        term = f"{art} {track}".strip()
        url = "https://itunes.apple.com/search?" + urllib.parse.urlencode({"term": term, "entity": "song", "limit": 1})
        try:
            async with session.get(url) as r:
                data = await r.json(content_type=None)
            res = (data or {}).get("results") or []
            if not res:
                continue
            art_url = res[0].get("artworkUrl100", "").replace("100x100bb", "800x800bb")
            if not art_url:
                continue
            async with session.get(art_url) as r:
                if r.status == 200:
                    return await r.read()
        except Exception as e:
            log.debug("itunes art failed: %s", e)
    return None
