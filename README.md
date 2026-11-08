# Backpacking research

My research on backpacking trips: one file per trip, published as a small website with a trips list, a page per trip, and a seasons and permits chart.

## Where things are

| Path | What it is |
| --- | --- |
| `trips/*.md` | One file per trip. **This is the only folder you normally edit.** |
| `trips/_template.md` | Copy this to start a new trip. |
| `tracks/*.gpx` | GPX files for your own routes on the trail map. |
| `assets/trails/` | Each trip's trail map, built automatically from `parkdata/`. Don't edit by hand. |
| `parkdata/` | Each park's full map data and elevation, downloaded automatically and not published. Don't edit by hand. |
| `_data/site.json` | Site title, the list of regions (in display order), and the GitHub repo name for "Edit" links. |
| `index.njk`, `seasons.njk`, `_includes/` | Page layouts. |
| `assets/` | Styles and the chart script. |
| `lib/normalize.js`, `scripts/check-trips.js` | Reads trip files and checks them for mistakes. |

## Editing a trip

Each trip file has two parts:

1. **The header**, between the two `---` lines. Standard fields that the chart, the trips list and the facts box use.
2. **The notes**, below the header. Free-form Markdown: routes, camps, links, anything specific to that trip.

You can edit on github.com (open the file, click the pencil, then **Commit changes**) or in any text editor. Obsidian works well too: it shows the header as an editable properties panel. Every trip page also has an **Edit this trip on GitHub** link.

After you commit, GitHub checks the files and republishes the site in about a minute. If something in a header can't be read, the check fails and the **Actions** tab says which file and field to fix, for example:

```
trips/zion.md seasons[2]: Sep doesn't have a day 31
```

The live site keeps the last good version until it's fixed.

## Sources

Cite sources with footnotes, which github.com and Obsidian show too. Put `[^name]` after the text it supports, and a line saying what the source is anywhere in the notes:

```markdown
## Mosquitoes[^reddit]

- Exposed granite tends to be safer.[^ranger]

[^reddit]: [r/norcalhiking](https://www.reddit.com/r/norcalhiking/s/...)
[^ranger]: Ranger at Pinecrest station, Aug 2026
```

On a heading it covers the section; after a line, just that line. Each source gets a small number where it's cited (the same number every time it's reused), and they're listed under **Sources** at the end of the trip page. The check fails if a `[^name]` has no matching line.

## Header fields

```yaml
name: Point Reyes National Seashore
short: Point Reyes             # optional: shorter name for the chart
region: Bay Area               # must be one of the regions in _data/site.json
order: 2                       # optional: position within the region
summary: One line for the trips list
status: Closed through Jan 31  # optional: shows a warning on the list and trip page
status link: https://...       # optional: where to check for updates (makes the warning a link)
status short: Closed until 1/31/27  # optional: shorter wording for the Trips table
updated: 2026-10-16            # optional: when you last updated the research
park: Point Reyes National Seashore  # optional: adds a trail map (see below)
# within: Stanislaus National Forest  # optional: the forest or park a wilderness is in, shown above the title
trailheads:                    # optional: trailheads missing from the map
  Bear Valley: 38.0405, -122.7998
camps:                         # optional: camps to always show on the map
  Sky Camp: 38.0298, -122.8361
routes:                        # optional: your own routes, as GPX files
  Coast Trail loop: tracks/point-reyes-coast.gpx
  Bear Valley to Wildcat: tracks/point-reyes-bear-valley.gpx
# or, if the trip is just one route, these two lines instead of routes: (see below)
# route: Coast Trail loop
# gpx: tracks/point-reyes-coast.gpx
# route link: https://www.alltrails.com/...  # optional: the route's page, linked next to GPX on the map
links:                         # optional: planning links shown under the map
  Park page: https://www.nps.gov/pore/

facts:                         # the facts box; labels are free-form
  Getting there: 1–1.5 hr drive   # also shown on the trips list
  Distance: ~30 mi                # also shown on the trips list (leave it out to show the GPX route length there)
  Water: Faucet at camps

seasons:                       # chart bars and the When to go list
  - shoulder: Jan 1 – Feb 28
    why: [rain, cold]          # optional reasons
    notes: The heaviest rain.  # optional: shown under When to go
  - peak: Sep 1 – Oct 31
    notes: Some of the clearest days.
  - off: Jun 1 – Aug 31        # listed under When to go, not drawn on the chart
    notes: Dense fog all day.

permit:                        # the chart; the Permits section itself is written in the notes
  note: 90/14 days before      # short note on the chart
  difficulty: 2                # 0 none, 1 book ahead, 2 competitive, 3 very hard
  why: Weekends sell out at release
  channels:                    # how permits are released (see below)
    - label: Reservations
      before: 90 days
      share: 50%
```

**Dates** are written like `Sep 1`. Ranges use a dash: `Sep 1 – Oct 31`.

**Season reasons** (`why`): `hot`, `dry`, `rain`, `cold`, `wind`, `fog`, `wet`, `bugs`, `snow`, `water`, `crowds`, `smoke`. Peak seasons can have them too.

### When to go

A trip page's **When to go** section is built from `seasons:`: one bullet per date range in date order, like **Aug – Mid Sep (Peak)**: *notes*. The label comes from the dates: the 1st or last day of a month is just the month, otherwise days 1–10 are Early, 11–20 Mid and 21 on Late. `off:` seasons are listed without a tag and not drawn on the chart.

- Several date ranges can share one season and note: `shoulder: Mar 1 – May 20, Sep 11 – Nov 30`. Each range is listed in its place in the year, with the same note.
- A range can run past New Year: `Nov 1 – Feb 28`.
- Touching peak seasons are drawn as one bar. Touching shoulders join only when their reasons match.
- Seasons can't overlap.
- A note with a colon followed by a space in it needs "double quotes" around the whole note.
- Anything else (sources, events, other research) goes under `## When to go` in the notes, and shows after the season bullets.
- **Sources**: cite them with footnotes, like anywhere else in the notes (see **Sources** below). For the whole section, put it on the heading in the notes: `## When to go[^name]`. For one season, put it at the end of its note: `notes: Warm, often mild weather.[^name]`. The `[^name]: ...` line goes in the notes.

### Writing the Permits section

Write it under `## Permits` in the notes, in your own words, so it reads well for that trip. The difficulty dots from the header are added next to the heading. Keep this order, skipping what doesn't apply:

1. **One or two lines first**: is a permit required, when (the quota season), and how hard it is to get.
2. **One bullet per way to get a permit**, its name in bold: `- **Reservations** (70%): on Recreation.gov, 90 days ahead.` Use the same names as the chart's channel labels where it makes sense. When the dates depend on the trip dates, list them underneath, trip dates first: `  - Jan–Mar: released Dec 5`.
3. **`**Cost**:`** fees, on one line.
4. **`**Camping**:`** where you can camp (zones, designated sites, night limits), if it matters.
5. **Anything else**: booking tips, open questions.
6. **The official permit page** as a link at the end.

Write dates like `Sep 1`, `Jan–Mar`, and "ahead" for how long before your trip. If a release date changes, update both this section and the header's `channels` (the chart).

### Permit channels

Each channel is one way permits are released. It becomes a lane on the chart.

- **Rolling** (opens a set time before your trip): `before: 90 days`, `24 weeks`, `6 months` or `day of`.
- **Lottery per week or month**: add `lottery: true` and `every: week` (or `month`), with `before` in the same unit.
- **Fixed date or range**: `opens: Apr 22` or `opens: Feb 1 – Feb 28`.
- **Several fixed releases**: a `releases` list, each with `opens` and `for` (the trip dates it covers). If a release opens after the trip dates it covers (e.g. Dec 5 for Jan–Mar), it's treated as the previous year.

Optional on any channel: `share` (e.g. `60%`), `note` (lane text), `lottery: true` (dashed band), `idle` (text shown when you're not hovering a season).

`trips/_template.md` has examples of each.

## Trail maps

Add `park:` with the park or wilderness name, spelled the way it is on [openstreetmap.org](https://www.openstreetmap.org) (search for it there to check). After you commit, the **Fetch trail maps** action downloads the area's trails, trailheads, camps, peaks, water and elevation once (from its state's OpenStreetMap file on [Geofabrik](https://download.geofabrik.de)) and saves it in `parkdata/`, builds the trip's map from it, and republishes the site in a few minutes. Later edits to the trip only rebuild the map; nothing is downloaded again. If the name isn't found, the action fails and says so.

- **Missing trailhead**: add it under `trailheads:` as `Name: latitude, longitude`. Right-click the spot in Google Maps to copy the coordinates.
- **Camps**: add the camps you mention under `camps:`, in the same `Name: latitude, longitude` format. They're always shown on the map, alongside the camps from OpenStreetMap. Only add ones OpenStreetMap doesn't have (check the All map data page), or they show twice.
- **Your own routes**: export each as GPX (AllTrails, CalTopo, Gaia), upload it to the `tracks` folder on github.com (**Add file → Upload files**), and add it under `routes:`. Routes are listed above the map; click one to draw it in blue on top of the trails. The elevation profile uses the elevations in the GPX file. In the notes, a link whose text is exactly the route name (e.g. `- [Coast Trail loop](https://www.alltrails.com/…)`) automatically shows the distance, elevation gain and elevation range measured from the GPX, plus a **Map** button. Don't type those numbers yourself; any notes after a `:` go on the next line.
- **A trip that is one route** (like Rim to Rim inside Grand Canyon, or Ohlone's one point-to-point): instead of `routes:`, write the route's name on `route:` and its GPX file on `gpx:`. The map then shows that route, always on with its elevation profile open, over the other trails, trailheads, camps, water and peaks within about 3 miles of it. The route can't be hidden, and there are no show/hide buttons. The park name also appears next to the region above the title.
- **Planning links**: the row under the map opens CalTopo and Gaia GPS on whatever area the map is showing. Add your own under `links:` as `Label: https://…` (ranger station, conditions page, FarOut, permits).
- **What the map shows**: add `map shows:` with the kinds you want, e.g. `map shows: dirt roads, paths, trailheads, camps`. You can use paths, footways, bridleways, cycleways, steps, dirt roads, trailheads, camps, peaks, water and boundaries (the park boundary). Without the line the map shows all of them except water. Peaks under 5,000 ft are never shown. Whatever your GPX route runs along (a road, a bike path, a street) is always shown, and the All map data page starts with the same kinds switched on.
- **All map data**: the small link next to the trail count opens a page with everything saved for the park, a switch for each kind of data, and a switch that greys out what the trip map leaves out. Handy for seeing why a trail or camp isn't on the map.
- **Missing or wrong trail**: fix it on openstreetmap.org (**Edit**), then run **Actions → Fetch trail maps → Run workflow** with the trip's name under **Or refresh one park** (e.g. `zion`). To refresh every park at once, tick **Redo every park** instead. The saved park data isn't refreshed otherwise.

## Adding a region

Add it to `regions` in `_data/site.json`, in the order you want it shown.

## Running it on your computer (optional)

Requires Node 22.

```
npm install
npm start          # preview at http://localhost:8080
npm run check      # just check the trip files
```

## Publishing setup (once)

In the repo's **Settings → Pages**, set **Source** to **GitHub Actions**. Then set `"repo"` in `_data/site.json` to `your-username/your-repo` so the Edit links work.
