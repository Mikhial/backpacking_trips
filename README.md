# Backpacking research

My research on backpacking trips: one file per trip, published as a small website with a trips list, a page per trip, and a seasons and permits chart.

## Where things are

| Path | What it is |
| --- | --- |
| `trips/*.md` | One file per trip. **This is the only folder you normally edit.** |
| `trips/_template.md` | Copy this to start a new trip. |
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

**Shoulder reasons** (`why`): `hot`, `dry`, `rain`, `cold`, `wind`, `fog`, `wet`, `bugs`, `snow`, `water`, `crowds`.

### Permit channels

Each channel is one way permits are released. It becomes a lane on the chart.

- **Rolling** (opens a set time before your trip): `before: 90 days`, `24 weeks`, `6 months` or `day of`.
- **Lottery per week or month**: add `lottery: true` and `every: week` (or `month`), with `before` in the same unit.
- **Fixed date or range**: `opens: Apr 22` or `opens: Feb 1 – Feb 28`.
- **Several fixed releases**: a `releases` list, each with `opens` and `for` (the trip dates it covers). If a release opens after the trip dates it covers (e.g. Dec 5 for Jan–Mar), it's treated as the previous year.

Optional on any channel: `share` (e.g. `60%`), `note` (lane text), `lottery: true` (dashed band), `idle` (text shown when you're not hovering a season).

`trips/_template.md` has examples of each.

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
