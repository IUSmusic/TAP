# Tap2Track

Web preview target: GitHub Pages static hosting.

## Overview

Tap2Track is a self-contained browser app that turns rhythmic tapping into three generated drum-track choices.

It is designed to work with:
- desk taps captured as button taps
- computer keyboard rhythmic input
- microphone onset detection for real-world percussive hits such as tapping on a desk or keyboard clicks

The app runs with no backend and no build step. It uses browser-side audio and optional browser ML so it can be deployed directly on GitHub Pages.

## Core Logic

Core data structures include:
- a global `state` object for tap input, microphone analysis, generated drum tracks, playback state, and presets
- a central `els` object for UI bindings
- lightweight namespaces inside `app.js` for `AudioEngine`, `Input`, `Analyzer`, `Groove`, `UI`, `Persistence`, and `Exporter`

## Current Features

- local tap capture from button, keyboard, and microphone onset detection
- BPM inference from rhythmic spacing
- groove analysis with stability and syncopation scoring
- three generated drum-track variants from the same rhythmic input
- genre modes: modern pop, indie, hip-hop, house, latin percussion, and rock
- `Fill 1` and `Fill 2` generation based on common drum fill shapes
- browser audio playback using Tone.js
- saved grooves and presets via `localStorage`
- MIDI export as a real `.mid` file
- JSON export for preserving groove data
- optional Magenta.js groove continuation path with fallback to the local groove engine
- static hosting compatibility for GitHub Pages

## Technical Integrations

### Tone.js

Playback is built on Tone.js in the browser with a synthesized drum kit for kick, snare, hat, and percussion.

### Web Audio + Microphone Onset Detection

The app uses `getUserMedia` and `AnalyserNode` to estimate transient peaks from real audio input. This enables rough rhythm capture from desk taps or keyboard sounds in-browser.

### MIDI Export

The app uses `@tonejs/midi` in the browser to build and download standard MIDI files locally.

### Optional Magenta.js

The app includes an optional Magenta.js path for browser-side continuation of a groove-like seed. If the model or network path is unavailable, the local groove engine remains fully functional.

## UI Direction

The visual system is intentionally aligned to the `IUSassistant` app:
- dark black/charcoal surfaces
- white accent language
- Cinzel headlines with Inter body text
- bordered panels and restrained monochrome controls

## Files

- `index.html` — app shell and controls
- `style.css` — I/US-aligned visual styling
- `app.js` — rhythm capture, generation, playback, export, presets, and optional ML continuation
- `LICENSE` — source-available license text

## Deployment on GitHub Pages

1. Create a new GitHub repository.
2. Upload the contents of this folder to the repository root.
3. In GitHub, open **Settings** → **Pages**.
4. Under **Build and deployment**, set the source to **Deploy from a branch**.
5. Choose the `main` branch and the root folder `/`.
6. Save.
7. After GitHub publishes the site, the app will be available at your GitHub Pages URL.

## Notes

- Audio starts only after user interaction, which is normal browser behavior.
- Microphone onset detection works best in a relatively quiet room.
- Optional Magenta continuation depends on loading external model assets in the browser.
- For best reliability, use current Chrome or Edge.

## Controls

- `T` tap a rhythm
- `Space` play or stop the selected track
- `1–3` choose a generated track
- `F` apply Fill 1
- `G` apply Fill 2
- `M` start or stop microphone capture

## License

This project includes the I/US-style source-available license text in `LICENSE`.
