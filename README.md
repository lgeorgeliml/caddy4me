# Caddy4Me v0.1

Your on-course caddie: club calls from your own distances, live GPS and live wind, plus a hole-by-hole stats card.

App link once published: https://lgeorgeliml.github.io/caddy4me/

## Publish on GitHub Pages
1. Sign in at github.com as lgeorgeliml.
2. New repository: name `caddy4me`, Public, then Create.
3. "uploading an existing file" link: drag in ALL files and the `icons`, `images` and `tests` folders from this folder. Commit.
4. Settings > Pages > Source: Deploy from a branch > `main` / `(root)` > Save.
5. Wait 1-2 minutes, open the link above in Chrome on your phone, menu (three dots) > Install app.

## Updating
Upload the changed files to the same repository (they replace the old ones). For V2 upload `index.html`, `styles.css`, `app.js`, `map.js`, `sw.js`, `manifest.webmanifest`, `README.md` and the new `images` folder. Close and reopen the app twice to pick up the new version.

## Files
- `index.html`, `styles.css`, `app.js` - screens (V2 "Twilight" look)
- `images/` - photos for Home, Summary, Before your round and the hole card; replace a file with the same name to swap a photo
- `engine.js` - caddie logic and stats (all tunable numbers in `K`)
- `map.js` - satellite map (Esri World Imagery), tap-to-target
- `sw.js`, `manifest.webmanifest`, `icons/` - offline + install
- `tests/engine.test.js` - run with `node tests/engine.test.js`

Your bag edits and rounds are stored only on your phone. Use Export backup to save a copy.
