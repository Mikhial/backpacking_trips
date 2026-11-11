---
# Copy this file to trips/<trip-name>.md (lowercase, dashes) and fill it in.
# Lines starting with # are comments. Delete anything you don't need.

name: Example Wilderness
short: Example            # optional: shorter name for the chart
region: Sierra Nevada     # one of the regions in _data/site.json
order: 5                  # optional: position within the region
summary: One line about what makes this trip special
status: ""                # optional, e.g. "Closed through Jan 31, 2027"
status link: ""           # optional: where to check for updates on the status
status short: ""          # optional: shorter wording for the Trips table
updated: 2026-11-03       # when you last updated your research
park: Example Wilderness  # optional: park or wilderness name as on openstreetmap.org; adds a trail map
within: Example National Forest  # optional: the forest or park it's in, shown above the title
# map shows: dirt roads, paths, trailheads, camps  # optional: only these on the trail map (also footways, bridleways, cycleways, steps, peaks, water, boundaries)

# If this trip is one route (not a park with several options), name it and add its GPX.
# The map then shows just that route, always on. Leave these out otherwise.
# route: Rockbound Pass loop
# gpx: tracks/rockbound-pass.gpx
# route link: https://www.alltrails.com/...  # optional: the route's page, linked next to GPX on the map

# Optional, for the trail map:
# trailheads:               # trailheads OpenStreetMap is missing. Name: latitude, longitude
#   Wrights Lake: 38.8466, -120.2353
# places:                   # other spots to mark on the map: at: latitude, longitude, and an optional note: for the tooltip
#   Rescue 1:
#     at: 33.82086, -116.56903
#     note: The last clean turnaround point.
# routes:                   # several routes to compare (instead of route + gpx). Name: a GPX file in the tracks folder
#   Rockbound Pass loop: tracks/rockbound-pass.gpx
# links:                    # official pages for planning, shown under the map. Label: web address
#   Conditions: https://www.fs.usda.gov/...

# Quick facts box. Labels are up to you; "Getting there" and "Distance" also appear on the trips list.
facts:
  Getting there: 3 hr drive
  Distance: 25 mi loop
  Elevation: 6,000–9,000 ft
  Nights: 2–3
  Water: Lakes and streams
  Food storage: Bear canister required

# Seasons: the chart bars and the When to go list on the trip page.
# Each line starts with peak:, shoulder: or off: (off is listed under When to go but not drawn), then dates.
# Several ranges are separated by commas; a range can run past New Year (Nov 1 – Feb 28).
# "why" (optional): hot, dry, rain, cold, wind, fog, wet, bugs, snow, water, crowds, smoke
# "notes" (optional): what that time of year is like. If a note has a colon followed by a space, put it in "double quotes".
seasons:
  - shoulder: Jun 1 – Jun 30
    why: [wet, bugs]
    notes: Still snow up high; mosquitoes bad.
  - peak: Jul 1 – Sep 15
    notes: Best weather.
  - off: Nov 1 – May 31
    notes: Road closed with snow.
# To cite a season's source, end its note with a footnote, like notes: Road closed.[^ranger] (see the README)

permit:
  note: 90 days before      # short note shown on the chart
  difficulty: 1             # dots: 0 none, 1 book ahead, 2 competitive, 3 very hard
  why: Weekends sell out    # shown when hovering the dots
  channels:
    # Rolling: opens a set time before your trip. "before" is like 90 days, 24 weeks, 6 months, or day of
    - label: Reservations
      before: 90 days
      share: 70%            # optional
    # Lottery that runs per calendar week or month:
    #   - label: Lottery
    #     lottery: true
    #     before: 24 weeks
    #     every: week
    # Fixed calendar date (or range), optionally saying which trip dates it covers:
    #   - label: Lottery
    #     lottery: true
    #     opens: Feb 1 – Feb 28
    #   - label: Reservations
    #     releases:
    #       - opens: Dec 5
    #         for: Jan 1 – Mar 31    # opening after the trip dates means the previous year
    #       - opens: Mar 5
    #         for: Apr 1 – Jun 30
---

## Overview

Free-form notes go here, in Markdown. Keep these first, in this order: Overview, Getting there, When to go, Permits. Then any headings you like: routes, camps, logistics. Cite sources with footnotes: "some fact.[^name]" and a line "[^name]: [Site name](https://...)" (see the README).

## Getting there

- **Drive**: 3 hours with no traffic.

## When to go

## Permits

Required year-round. Quota from May 1 to Sep 30. Weekends sell out at release.

- **Reservations** (70%): on Recreation.gov, 90 days ahead.
- **Walk-up** (30%): day of, at the ranger station.

**Cost**: $5/person/night + $6 reservation fee.

**Camping**: dispersed; first night in your permitted zone.

[Permit page](https://www.recreation.gov/...)
