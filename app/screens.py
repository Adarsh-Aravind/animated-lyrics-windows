"""Monitor discovery + one lyrics window per screen."""
from __future__ import annotations

import ctypes
import ctypes.wintypes as wt
import logging
import subprocess
from dataclasses import dataclass

log = logging.getLogger("screens")


@dataclass
class Monitor:
    left: int
    top: int
    width: int
    height: int
    primary: bool


def monitors() -> list[Monitor]:
    """All connected screens, primary first (coordinates as Windows reports them to this process)."""
    user32 = ctypes.windll.user32
    found: list[Monitor] = []

    class MONITORINFO(ctypes.Structure):
        _fields_ = [("cbSize", wt.DWORD), ("rcMonitor", wt.RECT), ("rcWork", wt.RECT), ("dwFlags", wt.DWORD)]

    Proc = ctypes.WINFUNCTYPE(ctypes.c_int, wt.HMONITOR, wt.HDC, ctypes.POINTER(wt.RECT), wt.LPARAM)

    def cb(hmon, hdc, rect, data):
        mi = MONITORINFO()
        mi.cbSize = ctypes.sizeof(MONITORINFO)
        if user32.GetMonitorInfoW(hmon, ctypes.byref(mi)):
            r = mi.rcMonitor
            found.append(Monitor(r.left, r.top, r.right - r.left, r.bottom - r.top, bool(mi.dwFlags & 1)))
        return 1

    user32.EnumDisplayMonitors(None, None, Proc(cb), 0)
    found.sort(key=lambda m: (not m.primary, m.left, m.top))
    return found


class ScreenManager:
    """Opens/closes the extra windows on non-primary screens."""

    def __init__(self, url: str, launch) -> None:
        self.url = url
        self.launch = launch          # launch(url, profile_name, extra_args) -> Popen | None
        self.extra: dict[int, subprocess.Popen] = {}

    def count(self) -> int:
        try:
            return len(monitors())
        except Exception:
            return 1

    def show_all(self) -> None:
        mons = monitors()
        for i, m in enumerate(mons):
            if m.primary:
                continue
            p = self.extra.get(i)
            if p and p.poll() is None:
                continue
            # land the window in the middle of that screen, then go fullscreen there
            w, h = min(900, m.width), min(600, m.height)
            x, y = m.left + (m.width - w) // 2, m.top + (m.height - h) // 2
            args = [f"--window-position={x},{y}", f"--window-size={w},{h}", "--start-fullscreen"]
            self.extra[i] = self.launch(f"{self.url}?screen={i}", f"screen-{i}", args)
            log.info("opened window on screen %d (%dx%d at %d,%d)", i, m.width, m.height, m.left, m.top)

    def close_extra(self) -> None:
        for i, p in list(self.extra.items()):
            if p and p.poll() is None:
                subprocess.run(["taskkill", "/PID", str(p.pid), "/T", "/F"], capture_output=True,
                               creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            self.extra.pop(i, None)
