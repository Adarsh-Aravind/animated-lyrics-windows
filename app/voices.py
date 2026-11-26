"""Who sings on a track: the credited artists and whether each is a woman or a man (MusicBrainz).

Lyrics don't say who sings which line, so this only tells the UI that a song is, say, a female +
male duet; the Chat style then splits the song between the two sides by sections. Results are
cached on disk per artist, and MusicBrainz asks for at most one request a second.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import time
import urllib.parse

import aiohttp

from .lyrics import clean_title
from .paths import DATA

log = logging.getLogger("voices")

MB_ROOT = "https://musicbrainz.org/ws/2/"
HEADERS = {
    "User-Agent": "AnimatedLyrics/1.4 ( https://github.com/Adarsh-Aravind/animated-lyrics-windows )",
    "Accept": "application/json",
}
CACHE_FILE = DATA / "voices.json"

_SPLIT = re.compile(r"\s*(?:,|&|\+|/|\bx\b|\band\b|\bfeat\.?|\bft\.?|\bfeaturing\b|\bwith\b)\s*", re.I)
_FEAT_PAREN = re.compile(r"[\(\[]\s*(?:feat\.?|ft\.?|featuring|with)\s+([^\)\]]+)[\)\]]", re.I)
_FEAT_TAIL = re.compile(r"\s(?:feat\.?|ft\.?|featuring)\s+(.+)$", re.I)


def _norm(s: str) -> str:
    return re.sub(r"[^\w]", "", (s or "").lower())


def credited(title: str, artist: str) -> list[str]:
    """Every name credited on the track, main artist first: 'A, B', 'A & B', '(feat. C and D)'."""
    a = re.sub(r"\s*-\s*Topic$", "", artist or "")
    a = re.sub(r"VEVO$", "", a, flags=re.I)
    parts = _SPLIT.split(a)
    m = _FEAT_PAREN.search(title or "") or _FEAT_TAIL.search(title or "")
    if m:
        parts += _SPLIT.split(m.group(1))
    out, seen = [], set()
    for p in parts:
        p = p.strip(" -|")
        if len(p) < 2 or _norm(p) in seen:
            continue
        seen.add(_norm(p))
        out.append(p)
    return out[:4]


class Voices:
    def __init__(self) -> None:
        try:
            self.cache: dict = json.loads(CACHE_FILE.read_text("utf-8"))
        except Exception:
            self.cache = {}
        self._lock = asyncio.Lock()
        self._last = 0.0

    def _save(self) -> None:
        try:
            CACHE_FILE.write_text(json.dumps(self.cache), "utf-8")
        except Exception as e:
            log.debug("couldn't save voices cache: %s", e)

    async def _get(self, session: aiohttp.ClientSession, path: str, params: dict | None = None) -> dict | None:
        """One polite MusicBrainz request: spaced out, retried when the server says it's busy."""
        url = MB_ROOT + path + ("?" + urllib.parse.urlencode({**(params or {}), "fmt": "json"}))
        async with self._lock:
            for attempt in range(4):
                wait = 1.5 - (time.monotonic() - self._last)
                if wait > 0:
                    await asyncio.sleep(wait)
                self._last = time.monotonic()
                try:
                    async with session.get(url, headers=HEADERS) as r:
                        if r.status == 200:
                            return await r.json(content_type=None)
                        if r.status not in (429, 503):
                            return None
                except Exception as e:
                    log.debug("musicbrainz request failed: %s", e)
                    return None
                await asyncio.sleep(2.5 * (attempt + 1))  # busy: back off and try again
        return None

    async def _credit_ids(self, session: aiohttp.ClientSession, title: str, names: list[str]) -> dict[str, str]:
        """Find the song itself so each credited name maps to the exact artist (there are many Tylas)."""
        base = f'recording:"{clean_title(title)}"'
        everyone = base + "".join(f' AND artist:"{n}"' for n in names)
        data = await self._get(session, "recording/", {"query": everyone, "limit": 5})
        if not (data or {}).get("recordings"):  # the version with everyone isn't listed: try the main artist alone
            data = await self._get(session, "recording/", {"query": f'{base} AND artist:"{names[0]}"', "limit": 5})
        ids: dict[str, str] = {}
        for rec in (data or {}).get("recordings", []):
            if rec.get("score", 0) < 80:
                continue
            for c in rec.get("artist-credit") or []:
                art = c.get("artist") or {}
                for n in (c.get("name"), art.get("name")):
                    if n and art.get("id"):
                        ids.setdefault(_norm(n), art["id"])
        return ids

    async def _gender_by_id(self, session: aiohttp.ClientSession, mbid: str) -> str | None:
        key = "id:" + mbid
        if key in self.cache:
            return self.cache[key]
        data = await self._get(session, f"artist/{mbid}")
        if data is None:
            return None  # don't cache: try again next time
        g = (data.get("gender") or "").lower() if data.get("type") == "Person" else ""
        self.cache[key] = g if g in ("female", "male") else None
        self._save()
        return self.cache[key]

    async def _gender_by_name(self, session: aiohttp.ClientSession, name: str) -> str | None:
        """Fallback when the song isn't on MusicBrainz: only trust a name that matches one person clearly."""
        key = "name:" + _norm(name)
        if key in self.cache:
            return self.cache[key]
        data = await self._get(session, "artist/", {"query": f'artist:"{name}"', "limit": 5})
        if data is None:
            return None
        same = [a for a in data.get("artists", []) if a.get("score", 0) >= 85
                and _norm(name) in {_norm(n) for n in [a.get("name", "")] + [al.get("name", "") for al in a.get("aliases") or []]}]
        people = [a for a in same if a.get("type") == "Person"]
        genders = {(a.get("gender") or "").lower() for a in people}
        g = genders.pop() if len(people) >= 1 and len(genders) == 1 else None  # several different people: don't guess
        g = g if g in ("female", "male") else None
        self.cache[key] = g
        self._save()
        return g

    async def lookup(self, session: aiohttp.ClientSession, title: str, artist: str) -> list[dict]:
        names = credited(title, artist)
        if len(names) < 2:
            return []  # a solo credit can't tell us a duet split
        song = "song:" + _norm(names[0]) + "|" + _norm(clean_title(title))
        ids = self.cache.get(song)
        if ids is None:
            ids = await self._credit_ids(session, title, names)
            if ids:
                self.cache[song] = ids
                self._save()
        out = []
        for n in names:
            mbid = ids.get(_norm(n)) if ids else None
            g = await (self._gender_by_id(session, mbid) if mbid else self._gender_by_name(session, n))
            log.info("voice: %s -> %s%s", n, g or "unknown", "" if mbid else " (by name)")
            out.append({"name": n, "gender": g})
        return out
