# Kangaroo Survey Simulators

Training simulators for kangaroo aerial survey observers.

**Run online:** https://steve2302.github.io/flight-sim/

| | |
|---|---|
| [`SPOTTER_Trainer/`](SPOTTER_Trainer/) | Full observer trainer (Three.js). Scoring, SPOTTER `.dat` output and observer comparison. See its [README](SPOTTER_Trainer/README.md). |
| [`outback_window_seat.py`](outback_window_seat.py) | Original Pygame prototype. Desktop only for now; ready for a WebAssembly build with [pygbag](https://pypi.org/project/pygbag/). |

## Running locally

- **SPOTTER Trainer:** open `SPOTTER_Trainer/index.html` in Chrome or Edge.
- **Outback Window Seat:** `pip install pygame-ce` (or `pygame`), then `python outback_window_seat.py`.

## Web deployment

GitHub Pages serves this repository's `main` branch directly, so every push updates the site. `index.html` is the landing page.

To also run `outback_window_seat.py` in the browser, build it with pygbag (`pip install pygbag`, copy the file to `build/outback/main.py`, then `python -m pygbag --build build/outback`) and publish `build/outback/build/web` as `outback/`. The main loop is already async, which pygbag needs.
