# Notes for Claude

Mike's backpacking research site. Eleventy, published to GitHub Pages at https://mikhial.github.io/backpacking_trips/ by `.github/workflows/deploy.yml` on every push to `main`. The README explains the trip-file format; read it before editing trips.

## How to make changes (always follow this)

1. Make changes on a new branch. Never push to `main` (merging to main publishes the site).
2. Run `npm run build` to check the trip files and build the site.
3. Publish the built site as a private preview artifact Mike can click through. It's a multi-page site, so make sure links between pages and the CSS/JS work in the preview. The normal build uses root-relative paths with a `/backpacking_trips/` prefix, which won't work in a preview hosted elsewhere.
4. Tell Mike which pages changed, then wait for his OK. Apply follow-up changes to the same branch and update the same preview.
5. When he approves, open a pull request with a short summary. Mike merges it himself.

## How Mike works

- He edits trip files himself on github.com, so the header format must stay simple and readable. Don't add fields that need code to understand.
- Keep his own wording in trip notes. Reorganize, don't rewrite. Don't add facts that aren't in his notes; flag gaps instead.
- He prefers clean, uncluttered visuals and iterates by looking. Show a mockup before big visual changes.
- Run `npm run build` (checks trips, then builds) and look at the pages before pushing.

## Chart design decisions (assets/chart.js)

- Rows are compact at rest: season bars, one thin booking band for the trip's **first** permit channel, and the short note (`permit.note`).
- A row expands only when a season bar is hovered, and collapses only when the pointer leaves the row. Trip pages show their row always expanded.
- Expanded: one lane per permit channel. Lane text is "**label** · note (share)"; the hover date goes on its own line below it.
- Hover dates: "opens Jun 9", "apply Feb 1–28" (lotteries), "day of" (walk-up).
- Booking bands are colored by the season they serve (dark blue = peak, light blue = shoulder). Lotteries are the same bar with small breaks (dashed). No separate "fixed date" color.
- Fixed releases are drawn only when they cover a season month.
- Connectors appear only while hovering a season bar. Lottery connectors are a funnel covering the whole application window. Weekly/monthly lotteries snap to calendar weeks/months.
- The previous year is shown left of the trip year: Oct–Dec at full scale, Jan–Sep squeezed into a narrow hatched strip.
- "Today" lines are subtle dashed lines; the previous-year one only shows when today falls in Oct–Dec.
- Permit difficulty dots (0–3) are right-aligned after the trip name, with the reason in a tooltip.
- Season reasons (`why`, peak or shoulder) appear only as text on hover, never as icons on the bars. The side text uses short words (`short` in ICONS) so it fits; the full wording is in the bar tooltip.
- Create PNG renders the compact view for pasting into Google Docs.

## Trail map data

Plan: https://claude.ai/artifact/HZuFFKyBxap5YeW4Rg1dmz ("Trail Map Data Plan"). Two steps, both run by `.github/workflows/trail-data.yml`:

1. `scripts/download-parks.js` saves everything OpenStreetMap has in each park's area, nothing dropped, as `parkdata/<park>/full.osm.pbf` (+ `park.json`, elevation tiles; committed, not published). Saved per `park:` line (the wilderness, not the forest in `within:`), covering the boundary + 3 km + any routes/trailheads outside it.
   - Every park is cut out of its state's Geofabrik file with osmium; parks in one state share one download. A new park's state is looked up once on Nominatim and saved as `region` in its `osm.json`.
   - Overpass is not used: its public servers were overloaded for a whole day (Nov 4, 2026) and say automated use should run its own server.
   - Failures stop the run with a clear message and no long retry loops (Mike: "if it fails, exit early"). Parks already saved are still built and committed.
   - `--all` redoes every park; a trip or park name redoes just that one; `--cache DIR` keeps state files in DIR and reuses them the same day.
   - Then `lib/pick.js` picks from it, with no downloading: `osm.json` (what trip maps use: trails incl. cycleways, roads, trailheads, camps, peaks, water, and every piece of a long-distance trail even on paved roads, per Mike) and `all.json` (everything, for the All map data page). Both committed (Mike's call). `scripts/pick-features.js` re-picks by hand; `download-parks.js` re-picks any park whose `osm.json` `rules` fingerprint is older than `lib/pick.js`.
   - Two versions of each park's map, by design: the All map data page shows everything; the trip map drops things for clarity.
2. `scripts/build-maps.js` builds `assets/trails/<trip>.json` from `parkdata/` with no network. Map display changes go here; never re-download for them.
   - It also writes `assets/parks/<park>/` for the park's "All map data" page (`parks.njk`, `assets/parkmap.js`, `/parks/<park>/`): `index.json` plus one file per large kind (small kinds share `small.json`), each feature marked if the trip map drops it. The page opens with the trip map's kinds on (Mike's call) and loads other kinds when switched on. `shownIds()` repeats the trip map's keep/drop rules (including the ones in `assets/trailmap.js`); keep them in sync.
   - One-route trips cover ~5 km (3 mi) around the route (`ROUTE_PAD`), with other trails shown; the route is always on.
   - Camps (yours and OpenStreetMap's) show at every zoom, grouped into a count dot where they overlap. Don't list a camp or trailhead in a trip header if OpenStreetMap already has it (it would show twice).

Working on it locally:
- osmium is at `/opt/homebrew/bin/osmium`, which isn't on the default shell PATH: `export PATH=/opt/homebrew/bin:$PATH`.
- State files are large (California ~1.3 GB): use `--cache` with a scratchpad folder, never the repo.
- After changing either script, copy `assets/trails/` aside, rebuild, and compare trail/point counts, total length and gain per trip. Explain every difference (so far they've all been OpenStreetMap edits).
- Preview artifacts don't show the topo map background (the preview blocks the USGS tiles); trails and points still draw. To check backgrounds, run `npx @11ty/eleventy --serve` and give Mike the localhost link.
- Budget: about 1 GB for `parkdata/` in all; no file over 100 MB (GitHub's limit). Report park sizes when they change. As of Nov 4, 2026: 209 MB for 11 parks; Grand Canyon 84 MB (630 elevation tiles) and John Muir 51 MB (300) are the largest, the rest 2.5–22 MB.
- Workflow: `download-parks.js --check` decides whether osmium is installed and anything downloaded, so notes edits only rebuild (and commit nothing).

## Open questions in the research

- Hetch Hetchy: chart peak is Jul 11–Sep 30 (Mike's instruction), but his detailed notes say Apr–Jun and Oct–Nov are best and Jul–Sep is hot.
- Grand Canyon: campground lottery is 5 months ahead in one note, ~4 months in another.
- Grand Canyon R2R: North Kaibab Trail under repair; Ventana closed through Jan 31, 2027. Both are in `status`.
- His original detailed research doc covers ~10 more areas (Carson Pass, Sinkyone, Lassen, Trinity Alps, Joshua Tree, Death Valley, Enchantments, Paria, Coyote Gulch, Big Bend) not yet added as trips.
