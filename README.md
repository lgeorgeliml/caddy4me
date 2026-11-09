# Caddy4Me v0.9

Your on-course caddie: club calls from your own distances, live GPS and live wind, plus a hole-by-hole stats card.

App link once published: https://lgeorgeliml.github.io/caddy4me/

## Publish on GitHub Pages
1. Sign in at github.com as lgeorgeliml.
2. New repository: name `caddy4me`, Public, then Create.
3. "uploading an existing file" link: drag in ALL files and the `icons`, `images` and `tests` folders from this folder. Commit.
4. Settings > Pages > Source: Deploy from a branch > `main` / `(root)` > Save.
5. Wait 1-2 minutes, open the link above in Chrome on your phone, menu (three dots) > Install app.

## Updating
Upload the changed files to the same repository (they replace the old ones). Close and reopen the app twice to pick up the new version.
The release number lives in `version.js`: change it on every release and phones drop the old offline copy. Settings shows it at the bottom.

## Files
- `index.html`, `styles.css`, `app.js` - screens (V2 "Twilight" look)
- `images/` - photos for Home, Summary, Before your round and the hole card; replace a file with the same name to swap a photo
- `engine.js` - caddie logic and stats (all tunable numbers in `K`)
- `map.js` - satellite map (Esri World Imagery), tap-to-target, rotated hole view
- `course.js`, `course-melville.js` - hole layouts from OpenStreetMap (front / middle / back, bunkers)
- `course-book.js` - Melville Glades yardage book data (Members tee distances, tips, green notes, heights)
- `strategy.js` - course strategy: a plan for every hole from your bag, past rounds and handicap (Smart Bogey Golf, Stableford Points, Attacking)
- `rules.js` - rules compliance: which features a rule set allows (social, or competition under Rule 4.3). Tournament Mode uses the competition set
- `version.js` - release number for Settings and the offline cache
- `sw.js`, `manifest.webmanifest`, `icons/` - offline + install
- `tests/` - unit tests, shared golf cases runner (`tests/golf-cases/`), browser tests (`tests/e2e/`) and test fixtures
- `tests/golf-cases/generate.js` writes the shared golf cases from this app's logic; `strategy-texts.js` writes the plan-wording fixture the Android app checks against

## Tests
GitHub Actions runs every test on each upload (`.github/workflows/test.yml`): unit tests, the shared golf test cases at the version in `golf-cases.version`, and the browser tests. Locally: `npm install`, `npx playwright install chromium`, then `npm test`.
This web app is the lean prototype (Track A). The Android product lives in the private `caddy4me-android` repo, and both must pass the same shared golf test cases.

Your bag, rounds and hole notes are stored only on your phone. Use Export backup to save a copy.

## Backup format
The backup file is shared with the Android app: its format lives in the golf cases repo (`backup/FORMAT.md`, from golf cases 1.3.0). `tests/e2e/backup.e2e.js` restores every sample backup there, checks that fields this app doesn't know survive, and checks Export against the format. **A new stat on the hole card or round is added to the format first** (as an optional field), then built here, then in the Android app.
