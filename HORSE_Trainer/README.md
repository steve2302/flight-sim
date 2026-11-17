# Horse Survey Trainer

Observer training simulator for feral horse helicopter surveys. Observers watch the view from a helicopter door and log horse bands with the same Xbox controller as SPOTTER. The trainer scores each observer against the known truth and compares observers who flew the same scenario.

This is a separate copy of the SPOTTER (kangaroo) Trainer. Logging, scoring, reports and observer comparison work the same way. The survey geometry, animals, landscape and cabin view are different.

## Running it

Double-click `index.html` (Chrome or Edge), or use the online version. Nothing needs installing. Press any button on the Xbox controller once so the browser detects it.

## Survey geometry

| | |
|---|---|
| Aircraft | Helicopter, 61 m above ground, 50 kn (25.7 m/s) |
| Blind strip | 20 m from nadir. Bins are measured from its outer edge. |
| Bins | 0–20 (yellow), 20–40 (green), 40–70 (blue), 70–100 (black), 100–150 (orange). That is 20–40, 40–60, 60–90, 90–120 and 120–170 m from nadir. |
| Seats | Rear left, rear right, and front left (used on some flights). The pilot sits front right. |
| Markers | Bin tape on the door pillar and on the door frame, fixed to the helicopter. Roll moves the ground relative to them. |

All of these values are in `js/core.js` (`ST.CFG`).

## Recording a band

| Button | Records |
|---|---|
| Right trigger | `horse` (starts a new record) |
| A / B / Y / X, right stick down | 1 / 2 / 3 / 4 / 10, summed: the **total** band size, foals included |
| Left shoulder | `foal`, one press per foal |
| D-pad down / left / up / right | bins 0–20 / 20–40 / 40–70 / 70–100 |
| Right stick left | bin 100–150 |
| Right shoulder | glare |
| Back | delete last record |

For example, a band of 5 with 2 foals in the 40–70 m bin is: right trigger, X, A, left shoulder, left shoulder, d-pad up.

Orange for the 100–150 m bin and the right-stick-left button for it are placeholders. Load your own `GamepadAudioConfig.csv` on the setup screen to change any of these.

## Horses and other animals

- **Bands.** Singles, bachelor groups of 2–4 and harem bands of 3–10, occasionally larger where bands have merged. About a third of mares in a harem band have a foal at foot. Coats are bay, brown, chestnut, black, grey, buckskin and palomino. Foals stand beside their dams.
- **Galloping.** About 60% of bands bolt when the helicopter is 40–220 m short of them. They accelerate to a gallop (7–12 m/s), mostly away from the flight line, bunch into a running file within about 3 s, run for 4–11 s, then pull up and stand with heads up. Bands that don't run graze or stand and look around.
- **True bin.** The scored bin is where the band was **when it first came into view**, even if it then galloped further out. A band that bolts and leaves the strip before it can be seen is not counted.
- **Distractors (not logged).** Deer, cattle, wombats, granite rocks and fallen logs.

## Habitats

- Alpine high plains: tussock grassland, snow gum edges
- Snow gum woodland: subalpine, grassy understorey
- Tablelands forest: tall eucalypt forest with grassy clearings
- Tablelands open: grazing country with scattered trees

## Scoring

Scoring works as in the SPOTTER Trainer, with foals added:

- **Record quality:** bin 40% (half for an adjacent bin), count 40% (half if within ±10%), foals 20%. A record logged under another species code gets half.
- **Report:** foal accuracy shows on the report and the observer-comparison screen.
- **Results CSV:** includes `foals_true` and `foals_recorded`.

Playback speed (25–100%) and animal size (up to ×4) work as in the SPOTTER Trainer.

## Files

```
index.html, style.css     UI
js/core.js                config, geometry, controller map, seeded RNG, noise
js/scenario.js            horse bands, gallop motion, distractors, habitats (ground truth)
js/spotter.js             SPOTTER emulation: config CSV, record builder, .dat read/write, controller input
js/scoring.js             matching, metrics (incl. foals), observer comparison, CSV export
js/world.js               3D scene (Three.js r128, vendored in vendor/), horse/deer/cattle models
js/overlay.js             helicopter door, pillar and skid, bin markers, glare
js/app.js                 setup → run → report → compare
tests/*.test.js           Node tests (node --test tests/)
tests/lineup.html         dev page: horse bands in each bin (serve the folder, then open it)
```
