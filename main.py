"""Animated Lyrics for Windows.

    python main.py              # opens the lyrics window
    python main.py --browser    # just run the server; open the URL in any browser
    python main.py --fullscreen # start fullscreen
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.request
import webbrowser
from pathlib import Path

from aiohttp import web

from app.paths import DATA
from app.screens import ScreenManager
from app.server import build_app

ROOT = Path(__file__).resolve().parent


def free_port(preferred: int) -> int:
    for port in (preferred, 0):
        with socket.socket() as s:
            try:
                s.bind(("127.0.0.1", port))
                return s.getsockname()[1]
            except OSError:
                continue
    raise RuntimeError("no free port")


def find_browser() -> str | None:
    candidates = [
        os.path.expandvars(r"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"),
        os.path.expandvars(r"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"),
        os.path.expandvars(r"%ProgramFiles%\Google\Chrome\Application\chrome.exe"),
        os.path.expandvars(r"%LocalAppData%\Google\Chrome\Application\chrome.exe"),
    ]
    for c in candidates:
        if os.path.exists(c):
            return c
    return shutil.which("msedge") or shutil.which("chrome")


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=5757)
    ap.add_argument("--browser", action="store_true", help="don't open an app window")
    ap.add_argument("--fullscreen", action="store_true")
    ap.add_argument("--debug", action="store_true")
    args = ap.parse_args()

    log_kw = {}
    if sys.stderr is None:  # started with pythonw (no console): log to a file instead
        log_kw["filename"] = str(DATA / "app.log")
    logging.basicConfig(
        level=logging.DEBUG if args.debug else logging.INFO,
        format="%(asctime)s %(name)s: %(message)s", datefmt="%H:%M:%S", **log_kw,
    )
    logging.getLogger("aiohttp.access").setLevel(logging.WARNING)

    loop = asyncio.get_running_loop()
    default_handler = loop.get_exception_handler()

    def quiet(loop, ctx):  # Windows logs harmless resets when the window closes a socket
        if isinstance(ctx.get("exception"), (ConnectionResetError, ConnectionAbortedError)):
            return
        if default_handler:
            default_handler(loop, ctx)
        else:
            loop.default_exception_handler(ctx)

    loop.set_exception_handler(quiet)

    ensure_shortcuts()

    # Already running? Just open another window onto it.
    existing = f"http://127.0.0.1:{args.port}/"
    if already_running(existing):
        logging.info("already running, opening a window")
        open_window(existing, "window-profile", ["--start-fullscreen"] if args.fullscreen else None)
        return

    port = free_port(args.port)
    url = f"http://127.0.0.1:{port}/"
    app = build_app()
    hub = app["hub"]
    runner = web.AppRunner(app)
    await runner.setup()
    await web.TCPSite(runner, "127.0.0.1", port).start()
    print(f"Animated Lyrics running at {url}")

    if args.browser:
        try:
            await asyncio.Event().wait()
        finally:
            await runner.cleanup()
        return

    screens = ScreenManager(url, open_window)
    hub.screen_count = screens.count
    hub.on_screens = lambda action: screens.show_all() if action == "all" else screens.close_extra()

    open_window(url, "window-profile", ["--start-fullscreen"] if args.fullscreen else None)
    if hub.settings.get("allScreens") and screens.count() > 1:
        screens.show_all()

    # Quit once the main lyrics window has been closed (more reliable than watching
    # the Edge process, which can hand off to another process and exit).
    started = last_seen = time.time()
    ever = False
    try:
        while True:
            await asyncio.sleep(1)
            if hub.main_clients:
                ever, last_seen = True, time.time()
            elif ever and time.time() - last_seen > 6:
                break
            elif not ever and time.time() - started > 90:
                break
    finally:
        logging.info("window closed, exiting")
        screens.close_extra()
        await runner.cleanup()


def ensure_shortcuts() -> None:
    """Packaged app only: put 'Animated Lyrics' on the Desktop and in the Start menu once."""
    if not getattr(sys, "frozen", False):
        return
    marker = DATA / "shortcuts-made"
    if marker.exists():
        return
    exe = sys.executable
    ps = (
        "$s=New-Object -ComObject WScript.Shell;"
        "foreach($d in @([Environment]::GetFolderPath('Desktop'), (Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs'))){"
        "$l=$s.CreateShortcut((Join-Path $d 'Animated Lyrics.lnk'));"
        f"$l.TargetPath='{exe}';$l.WorkingDirectory='{os.path.dirname(exe)}';$l.IconLocation='{exe},0';"
        "$l.Description='Animated lyrics for whatever you are playing';$l.Save()}"
    )
    try:
        subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps], capture_output=True, timeout=20,
                       creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        marker.write_text("ok")
    except Exception as e:
        logging.warning("couldn't create shortcuts: %s", e)


def already_running(url: str) -> bool:
    try:
        with urllib.request.urlopen(url + "__ping", timeout=1) as r:
            return r.read() == b"animated-lyrics"
    except Exception:
        return False


def open_window(url: str, profile_name: str = "window-profile", extra: list[str] | None = None):
    """Open a borderless app window. Each screen gets its own profile so it's its own process."""
    exe = find_browser()
    if not exe:
        webbrowser.open(url)
        return None
    profile = DATA / profile_name
    profile.mkdir(parents=True, exist_ok=True)
    cmd = [
        exe, f"--app={url}", f"--user-data-dir={profile}", "--no-first-run",
        "--no-default-browser-check", "--disable-features=Translate,msEdgeSidebarV2",
        "--autoplay-policy=no-user-gesture-required",
    ]
    cmd += extra or ["--window-size=1280,780"]
    return subprocess.Popen(cmd)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        sys.exit(0)
