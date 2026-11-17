# SPOTTER Trainer

Observer training simulator for the NSW Western Plains kangaroo aerial survey. Observers watch the view from a Cessna Caravan window and log kangaroo groups with the same Xbox controller mapping as SPOTTER. The trainer then scores each observer against the known truth and compares observers who flew the same scenario.

## Running it

Double-click `index.html` (Chrome or Edge). It needs no install, internet connection or server. Press any button on the Xbox controller once so the browser detects it.

## Survey geometry

| | |
|---|---|
| Aircraft | Cessna Caravan, 76 m above ground, 100 kn (51.4 m/s) |
| Blind strip | 40 m from nadir. Bins are measured from its outer edge. |
| Bins | 0–50 (yellow), 50–100 (green), 100–200 (blue), 200–300 (black). That is 40–90, 90–140, 140–240 and 240–340 m from nadir. |
| Strut markers | Placed where the sight line from the observer's eye to each bin boundary crosses the strut (about 63°, 40°, 29°, 18° and 13° below horizontal). They are fixed to the aircraft, so aircraft roll moves the ground relative to them, as it does in flight. |

All of these values are in `js/core.js` (`ST.CFG`).

## Controller

Button handling copies SPOTTER:
- Species buttons (`NewRecord=Yes`) start a new record. All other buttons append to the current record.
- Count presses are summed.
- Back appends `delete_last_record`. The scorer discards any record that contains it.

The default is SPOTTER's shipped `GamepadAudioConfig.csv`. Load a different config file on the setup screen to change it.

Keyboard fallback keys are listed on the setup screen. During a run: Esc/P pauses, F toggles full screen, H hides the HUD.

## Scenarios and repeatability

The whole run is generated from the seed:
- animal groups (species, size, position, behaviour, flushing)
- distractors (emus, sheep, stumps, rocks, termite mounds)
- vegetation
- aircraft motion

**Save scenario file** writes the full ground truth. To give several observers identical runs, load that file for each of them, or click **Same scenario, next observer** on the report screen.

## Outputs (report screen)

- **`.dat`**: SPOTTER format and file naming. Synthetic GPS positions run along a transect heading 090, so existing processing scripts can read the file.
- **`.session.json`**: every button press with its sim time, the records, and the embedded scenario. This is the file used for comparing observers.
- **`_results.csv`**: one row per group, giving truth against what was recorded.

## Scoring

Each record is matched one-to-one to a group on the observer's side of the aircraft. A record can only match a group if it was logged while the group was in view, or up to 3 s after it left. Among those, the best match is chosen on time relative to abeam, species, bin and count.

| Metric | Measures |
|---|---|
| Detection | Groups detected, overall and per bin. Per bin, this is the observer's detection function. |
| Accuracy | Species accuracy, a bin confusion matrix with near/far bias, and count accuracy by group size |
| Errors | False positives (naming the nearest distractor), groups logged outside the strip, data-entry errors |
| Overall score | 100 × total record quality ÷ (groups in strip + false positives + out-of-strip records). Record quality: species 35%, bin 35% (half for an adjacent bin), count 30% (half if within ±10%). |

## Comparing observers

On the **Compare observers** screen, load the `.session.json` files from observers who flew the same scenario. For each pair on the same side of the aircraft it shows:
- how many groups each observer saw on their own, and how many both saw
- detection probability estimated by double-observer (Lincoln–Petersen) methods, alongside the true rate
- species, bin (with Cohen's κ) and count agreement
- a group-by-group table

**Download MRDS-format CSV** writes one row per group per observer (object, observer, detected, binned distance, size), ready for the R `mrds` package.

## Limitations

- **Apparent size.** The view covers 66° vertically so all four bins fit on screen. On a typical monitor that makes animals look smaller than they do from the aircraft. **Animal size ×1.5** roughly corrects this. ×2 to ×4 are training aids for low-resolution screens and for learning species field marks. The setting is recorded in the session file, and the comparison screen warns if observers used different settings.
- **Models.** Animals, trees and shrubs are low-poly models, and terrain is procedural. Each species carries its main field marks: red males are rust-red with white underparts and are the largest; red females are blue-grey with white underparts; greys are uniform grey-brown with dark paws, feet and tail tip; goats stand square on four legs, often patterned. Every animal and distractor casts a sharp low-sun shadow, and grazing or sitting animals move their heads. Photo-based animal sprites and real aerial imagery would be the next step for realism.
- **Scenario files and geometry.** A scenario file records the survey geometry it was made with. Files made for a different height or bin layout (for example the earlier 96 m setting) are refused on the setup screen; generate a new scenario from the same seed instead.
- **Playback speed.** Runs can play at 25–100% speed. This is slow motion: sim time, aircraft speed (100 kn) and animal positions are unchanged, so scores and `.dat` files stay valid. In Practice mode, − and = change speed during the run. The rate and any changes are saved in the session file and shown on the report. The comparison screen warns when slowed runs are compared.
- **Seats.** Front and rear seats on the same side see the same ground. Only the strut's position in view changes.

## Files

```
index.html, style.css     UI
js/core.js                config, geometry, seeded RNG, noise
js/scenario.js            scenario generator (ground truth)
js/spotter.js             SPOTTER emulation: config CSV, record builder, .dat read/write, controller input
js/scoring.js             matching, metrics, observer comparison, CSV export
js/world.js               3D scene (Three.js r128, vendored in vendor/)
js/overlay.js             cabin, window, strut markers, glare
js/app.js                 setup → run → report → compare
tests/*.test.js           Node tests (node --test tests/)
tests/lineup.html         dev page: each species in each bin, for judging the view (serve the folder, then open it)
```

`js/core.js`, `js/scenario.js`, `js/spotter.js` and `js/scoring.js` don't touch the page, so they can be tested under Node.
