# Backpacking research

My research on backpacking trips: one file per trip, published as a small website with a trips list, a page per trip, and a seasons and permits chart.

## Where things are

| Path | What it is |
| --- | --- |
| `trips/*.md` | One file per trip. **This is the only folder you normally edit.** |
| `trips/_template.md` | Copy this to start a new trip. |
| `tracks/*.gpx` | GPX files for your own routes on the trail map. |
| `assets/trails/` | Trail map data, downloaded automatically. Don't edit by hand. |
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

## Header fields

```yaml
name: Point Reyes National Seashore
short: Point Reyes             # optional: shorter name for the chart
region: Bay Area               # must be one of the regions in _data/site.json
order: 2                       # optional: position within the region
summary: One line for the trips list
status: Closed through Jan 31  # optional: shows a warning on the list and trip page
updated: 2026-10-16            # optional: when you last updated the research
map: Point Reyes National Seashore   # optional: adds a trail map (see below)
trailheads:                    # optional: trailheads missing from the map
  Bear Valley: 38.0405, -122.7998
camps:                         # optional: camps to always show on the map
  Sky Camp: 38.0298, -122.8361
routes:                        # optional: your own routes, as GPX files
  Coast Trail loop: tracks/point-reyes-coast.gpx
links:                         # optional: planning links shown under the map
  Park page: https://www.nps.gov/pore/

facts:                         # the facts box; labels are free-form
  Getting there: 1–1.5 hr drive   # also shown on the trips list
  Distance: ~30 mi                # also shown on the trips list
  Water: Faucet at camps

seasons:                       # chart bars
  - shoulder: Jan 1 – Feb 28
    why: [rain, cold]          # optional reasons
  - peak: Sep 1 – Oct 31

permit:
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

### Permit channels

Each channel is one way permits are released. It becomes a lane on the chart.

- **Rolling** (opens a set time before your trip): `before: 90 days`, `24 weeks`, `6 months` or `day of`.
- **Lottery per week or month**: add `lottery: true` and `every: week` (or `month`), with `before` in the same unit.
- **Fixed date or range**: `opens: Apr 22` or `opens: Feb 1 – Feb 28`.
- **Several fixed releases**: a `releases` list, each with `opens` and `for` (the trip dates it covers). If a release opens after the trip dates it covers (e.g. Dec 5 for Jan–Mar), it's treated as the previous year.

Optional on any channel: `share` (e.g. `60%`), `note` (lane text), `lottery: true` (dashed band), `idle` (text shown when you're not hovering a season).

`trips/_template.md` has examples of each.

## Trail maps

Add `map:` with the park or wilderness name, spelled the way it is on [openstreetmap.org](https://www.openstreetmap.org) (search for it there to check). After you commit, the **Fetch trail maps** action downloads the area's trails, trailheads, camps, peaks and water from OpenStreetMap, adds elevations, and republishes the site in a few minutes. If the name isn't found, the action fails and says so.

- **Missing trailhead**: add it under `trailheads:` as `Name: latitude, longitude`. Right-click the spot in Google Maps to copy the coordinates.
- **Camps**: add the camps you mention under `camps:`, in the same `Name: latitude, longitude` format. They're always shown on the map and replace the camps from OpenStreetMap.
- **Your own route**: export it as GPX (AllTrails, CalTopo, Gaia), upload it to the `tracks` folder on github.com (**Add file → Upload files**), and add it under `routes:`. Routes are drawn in blue on top of the trails and listed above the map. The elevation profile uses the elevations in the GPX file. In the notes, a link whose text is exactly the route name (e.g. `- [Coast Trail loop](https://www.alltrails.com/…)`) automatically shows the distance, elevation gain and elevation range measured from the GPX, plus a **Map** button. Don't type those numbers yourself; any notes after a `:` go on the next line.
- **Only your routes**: add `map_trails: route only` under `map:` to hide the park boundary and the other trails. The map then shows just your routes, plus the trailheads, camps, water and peaks along them.
- **Planning links**: the row under the map opens CalTopo and Gaia GPS on whatever area the map is showing. Add your own under `links:` as `Label: https://…` (ranger station, conditions page, FarOut, permits).
- **Missing or wrong trail**: fix it on openstreetmap.org (**Edit**), then run **Actions → Fetch trail maps → Run workflow** with **Refetch every map** ticked. The map data isn't refreshed otherwise.

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
