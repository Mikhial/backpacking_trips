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

## Writing a new trip

Learned from Cactus to Clouds (PR #16), where Mike trimmed most of the first draft. Start lean and list what you left out so he can pull it back in.

- Short notes that change a decision on the day (turnarounds, heat, water, cutoffs). Skip full gear, safety and turn-by-turn sections. Terse place and season notes are fine, and so is an empty season note.
- Overview from his side ("Something I would need to train for"), not citations. Paraphrase sources, don't paste them.
- Route checkpoints go on the map as `places:`, not prose; the Route section keeps just the legs.
- Don't repeat what the GPX or map shows: no Distance or Elevation fact, no mileage in place notes, no weather link (the map has NWS forecasts). Planning links under the map can repeat links in the notes.
- Facts box: what the GPX can't tell (Getting there, Nights, Terrain).
- When to go is only seasons; temperature on the way goes in Pacing, trail closures in Permits. Permits follows the README's order.
- Clean links: no tracking codes, stable pages rather than single posts, anchors when there are any.
- Plain text first; no new styling or code unless he asks.

## Chart design decisions (assets/chart.js)

- Rows are compact at rest: season bars, one thin booking band for the trip's **first** permit channel, and the short note (`permit.note`).
- A row expands only when a season bar is hovered, and collapses only when the pointer leaves the row. Trip pages show their row always expanded, without the permit dots. A row with no permit channels still grows a little so the hover date fits (more if it has season reasons, so that line has padding below).
- Expanded: one lane per permit channel. Lane text is "**label** · note (share)"; the hover date goes on its own line below it.
- Hover dates: "opens Jun 9", "apply Feb 1–28" (lotteries), "day of" (walk-up).
- Booking bands are colored by the season they serve (dark blue = peak, light blue = shoulder). Lotteries are the same bar with small breaks (dashed). No separate "fixed date" color.
- Fixed releases are drawn only when they cover a season month.
- Connectors appear only while hovering a season bar. Lottery connectors are a funnel covering the whole application window. Weekly/monthly lotteries snap to calendar weeks/months.
- The previous year is shown left of the trip year: Oct–Dec at full scale, Jan–Sep squeezed into a narrow hatched strip.
- "Today" lines are subtle dashed lines; the previous-year one only shows when today falls in Oct–Dec.
- Permit difficulty dots (0–3) are right-aligned after the trip name, with the reason in a tooltip.
- Season reasons (`why`, peak or shoulder) appear only as text on hover, never as icons on the bars. The side text uses short words (`short` in ICONS) so it fits; the full wording is in the bar tooltip.
- Hovering a season bar shows "Peak season · Jun 1 – Sep 30" in the side text, with the reasons (short words) on their own line below, then a blank line before the permit lanes (only in rows that have reasons).

## Trail map data

Plan: https://claude.ai/artifact/HZuFFKyBxap5YeW4Rg1dmz ("Trail Map Data Plan"). Two steps, both run by `.github/workflows/trail-data.yml`:

1. `scripts/download-parks.js` saves everything OpenStreetMap has in each park's area, nothing dropped, as `parkdata/<park>/full.osm.pbf` (+ `park.json`, elevation tiles; committed, not published). Saved per `park:` line (the wilderness, not the forest in `within:`), covering the boundary + 3 km + any routes/trailheads outside it.
   - Every park is cut out of its state's Geofabrik file with osmium; parks in one state share one download. A new park's state is looked up once on Nominatim and saved as `region` in its `osm.json`.
   - Overpass is not used: its public servers were overloaded for a whole day (Nov 4, 2026) and say automated use should run its own server.
   - Failures stop the run with a clear message and no long retry loops (Mike: "if it fails, exit early"). Parks already saved are still built and committed.
   - `--all` redoes every park; a trip or park name redoes just that one; `--cache DIR` keeps state files in DIR and reuses them the same day.
   - Then `lib/pick.js` picks from it, with no downloading: `osm.json` (what trip maps use: trails incl. cycleways, roads, trailheads, camps, peaks, water, and every piece of a long-distance trail even on paved roads, per Mike) and `all.json` (for the All map data page; what it shows is Mike's list, documented at `onPage()` in `lib/pick.js`. Drops from the page are page-only: dropped kinds stay in `full.osm.pbf` so they can come back with a re-pick). Both committed (Mike's call). `scripts/pick-features.js` re-picks by hand; `download-parks.js` re-picks any park whose `osm.json` `rules` fingerprint is older than `lib/pick.js`.
   - Two versions of each park's map, by design: the All map data page shows (nearly) everything; the trip map drops things for clarity.
2. `scripts/build-maps.js` builds `assets/trails/<trip>.json` from `parkdata/` with no network. Map display changes go here; never re-download for them.
   - It also writes `assets/parks/<park>/` for the park's "All map data" page (`parks.njk`, `assets/parkmap.js`, `/parks/<park>/`): `index.json` plus one file per large kind (small kinds share `small.json`), each feature marked if the trip map drops it. The page opens with the trip map's kinds on (Mike's call) and loads other kinds when switched on. `shownIds()` repeats the trip map's keep/drop rules (including the ones in `assets/trailmap.js`); keep them in sync.
   - One-route trips cover what's within ~5 km (3 mi) of the route line and its trailheads (`ROUTE_M`, `corridor()` in build-maps.js), with other trails shown; the route is always on. The All map data page's "Hide what's more than 3 mi from <route>" switch uses the same rule (copied in assets/parkmap.js; keep in sync).
   - `map shows:` in a trip header (words in `MAP_WORDS`, lib/normalize.js) limits that trip map to those kinds (the park boundary only if `boundaries` is listed) and sets the All map data page's starting switches. Whatever a trip's GPX runs along (`follows`, found in lib/pick.js: most of a way's points within 30 m of the route) is always on its map, whatever its kind; changing a GPX re-picks the park (`routesKey`).
   - Water (springs, taps) is off unless a trip lists it, and peaks under 5,000 ft are never shown (`DEFAULT_OFF`, `MIN_PEAK_FT` in lib/normalize.js; Mike, Nov 5 2026, "for now"). Peaks with no OSM elevation are measured on the elevation tiles.
   - Dirt roads are all shown, named or not, at every zoom (Mike, Nov 5 2026), unless a trip's `map shows:` leaves them out.
   - `places:` in a trip header (name, then `at:` and optional `note:`) are white dots at every zoom, with the note in the tooltip (Mike, Nov 10 2026). Used for checkpoints instead of describing the route in the notes.
   - Camps (yours and OpenStreetMap's) show at every zoom, grouped into a count dot where they overlap. Don't list a camp or trailhead in a trip header if OpenStreetMap already has it (it would show twice).

Working on it locally:
- osmium is at `/opt/homebrew/bin/osmium`, which isn't on the default shell PATH: `export PATH=/opt/homebrew/bin:$PATH`.
- State files are large (California ~1.3 GB): use `--cache` with a scratchpad folder, never the repo.
- After changing either script, copy `assets/trails/` aside, rebuild, and compare trail/point counts, total length and gain per trip. Explain every difference (so far they've all been OpenStreetMap edits).
- Preview artifacts don't show the topo map background (the preview blocks the USGS tiles); trails and points still draw. To check backgrounds, run `npx @11ty/eleventy --serve` and give Mike the localhost link.
- Budget: about 1 GB for `parkdata/` in all; no file over 100 MB (GitHub's limit). Report park sizes when they change. As of Nov 4, 2026: 209 MB for 11 parks; Grand Canyon 84 MB (630 elevation tiles) and John Muir 51 MB (300) are the largest, the rest 2.5–22 MB.
- Workflow: `download-parks.js --check` decides whether osmium is installed and anything downloaded, so notes edits only rebuild (and commit nothing).

## Open questions in the research

- Hetch Hetchy: peak is Jun–Oct (his trip notes, Nov 6 2026), but his detailed research says Apr–Jun and Oct–Nov are best and Jul–Sep is hot.
- Grand Canyon: campground lottery is 5 months ahead in one note, ~4 months in another.
- Grand Canyon R2R: North Kaibab Trail under repair; Ventana closed through Jan 31, 2027. Both are in `status`.
- His original detailed research doc covers ~10 more areas (Carson Pass, Sinkyone, Lassen, Trinity Alps, Joshua Tree, Death Valley, Enchantments, Paria, Coyote Gulch, Big Bend) not yet added as trips.
