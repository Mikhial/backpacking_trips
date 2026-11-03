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

## Open questions in the research

- Hetch Hetchy: chart peak is Jul 11–Sep 30 (Mike's instruction), but his detailed notes say Apr–Jun and Oct–Nov are best and Jul–Sep is hot.
- Grand Canyon: campground lottery is 5 months ahead in one note, ~4 months in another.
- Grand Canyon R2R: North Kaibab Trail under repair; Ventana closed through Jan 31, 2027. Both are in `status`.
- His original detailed research doc covers ~10 more areas (Carson Pass, Sinkyone, Lassen, Trinity Alps, Joshua Tree, Death Valley, Enchantments, Paria, Coyote Gulch, Big Bend) not yet added as trips.
