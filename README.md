<p align="center">
  <img src="assets/icon.png" width="112" alt="Animated Lyrics icon">
</p>

<h1 align="center">Animated Lyrics for Windows</h1>

<p align="center">
  Lyrics of whatever you're playing, animated word by word, in album colours, with light flowing around the edges of your screen.
</p>

<p align="center">
  <a href="https://github.com/Adarsh-Aravind/animated-lyrics-windows/releases/latest"><b>⬇ Download for Windows</b></a>
</p>

---

## What it does

- **Follows any player.** Spotify, Apple Music, YouTube / YouTube Music in a browser, SoundCloud, Tidal, Deezer… anything that shows up in the Windows media controls. No login, no API keys.
- **Synced lyrics.** Time-synced lyrics come from [LRCLIB](https://lrclib.net), and the timing follows the player exactly, including pauses and seeks.
- **16 animation styles.** Glide · Pop · Stack · Spotlight · Bounce · Love · Wave · Scatter · Depth · Focus · Neon · Collage · Board · Glitch · Type · Cinema
- **Album colours.** Text, background and lights use only colours taken from the song's cover.
- **Backgrounds.** Animated gradient, blurred cover, album cover, or black.
- **Edge lighting.** *Flow* (light racing around the screen edges), *Glow*, or *Side lights*. They pulse with every word.
- **Every screen.** One switch puts full-screen lyrics on all your monitors, all in sync.
- **Easy.** *Surprise me* button, *New style every song*, and *Too early / Too late* buttons that remember the fix for each song.
- **Handles odd versions.** Music-video titles, remasters, and *slowed / sped-up* edits (the timing is stretched to fit).

## Install

1. Download **`Animated-Lyrics-Windows.zip`** from the [latest release](https://github.com/Adarsh-Aravind/animated-lyrics-windows/releases/latest).
2. Unzip it anywhere, for example in Documents.
3. Open **`Animated Lyrics.exe`**. The first time, it adds a Desktop and Start-menu shortcut.
4. Play a song.

> Windows may say *"Windows protected your PC"* because the app isn't code-signed. Click **More info → Run anyway**.

**Needs:** Windows 10 or 11, Microsoft Edge (built into Windows) and an internet connection to fetch lyrics.

## Using it

Move the mouse to open the menu. It hides itself again after a moment. Double-click anywhere for full screen.

| Key | Action |
|---|---|
| ← / → | Previous / next style |
| S | Surprise me (random style, background and light) |
| B | Background: Gradient → Blurred cover → Album cover → Black |
| L | Edge light: Glow → Flow → Side lights → Off |
| C | Album colours / white text |
| I | Show / hide the song name |
| F | Full screen |
| [ / ] | Lyrics too early / too late (saved per song) |
| Space | Play / pause |

When nothing is playing, a short preview runs so you can try the styles.

## How it works

```
Windows media controls ──► Python backend ──► WebSocket ──► animated page in an Edge app window
 (what's playing, position)   (aiohttp, LRCLIB lookup,         (styles, album palette,
                               cover art, settings)             edge lighting)
```

- `app/media.py` reads the current song, position and cover through the Windows `GlobalSystemMediaTransportControls` API.
- `app/lyrics.py` cleans up titles and finds synced lyrics on LRCLIB. Results are cached locally.
- `app/server.py` streams the track, lyrics and playback state to every open window, and keeps settings shared between screens.
- `app/screens.py` opens one full-screen window per extra monitor.
- `web/` is the front end: `engine.js` handles word timing, `styles.js` the 16 styles, and `visuals.js` the palette, backgrounds and edge lights.

Most songs only have line-by-line timing, so the timing of words within a line is estimated. It's exact when LRCLIB has word-level lyrics.

## Run from source

```bat
setup.bat                 :: creates .venv and installs requirements
"Animated Lyrics.bat"     :: starts the app
```

Or run `python main.py`. Options: `--fullscreen`, `--browser` (use your normal browser), `--port 5757`.
Preview the styles without music at `http://127.0.0.1:5757/?demo`.

### Build the .exe

```bat
build.bat
```

This produces `dist\Animated Lyrics\Animated Lyrics.exe` and a zip ready to share. It uses PyInstaller.

Settings, the lyrics cache and the log live in `%LOCALAPPDATA%\AnimatedLyrics` for the .exe, or in `cache\` when running from source.
