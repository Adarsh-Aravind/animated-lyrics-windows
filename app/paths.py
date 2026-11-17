"""Where things live, both when run from source and when packaged as an .exe."""
import os
import sys
from pathlib import Path

FROZEN = getattr(sys, "frozen", False)
BUNDLE = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent.parent))
WEB = BUNDLE / "web"
DATA = (Path(os.environ.get("LOCALAPPDATA") or Path.home()) / "AnimatedLyrics") if FROZEN else BUNDLE / "cache"
DATA.mkdir(parents=True, exist_ok=True)
