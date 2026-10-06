# Blog posts

One Markdown file per post, named `YYYY-MM-DD-readable-slug.md`. The name is the
post's date and its address: `2026-10-04-autumn-time-trial.md` is published at
`/blog/2026/10/04/autumn-time-trial`. Slugs are lowercase letters, digits and
hyphens.

Start the file with front matter:

```
---
title: Autumn time trial results
summary: One or two sentences for the list on /blog. Optional: without it the
  first paragraph is used.
author: Baldur
image: /blog-media/2026-10-04-start-line.jpg
draft: true
---
```

Only `title` is required. `draft: true` shows the post in local dev (`pnpm dev`)
and nowhere else; remove the line to publish. `image` is the picture shown when
the post is shared.

Write the post in ordinary Markdown below that: headings, **bold**, lists,
links, tables. Put images in `apps/web/public/blog-media/` (name them after the
post, e.g. `2026-10-04-start-line.jpg`, and keep them under ~500 KB) and use them
as `![what it shows](/blog-media/2026-10-04-start-line.jpg)`. They are served
from S3 with the rest of the site.

## Scheduling

A post goes live on its date, not before. Merge it any time: a post dated in
the future is left out of the site (its address 404s) until that day, when the
*Publish scheduled blog posts* workflow redeploys the site at 06:00 UTC (about
7am in the UK). If a morning's run fails, the next one catches up. To publish
a series, merge all the parts at once with a date each, e.g.
`2026-10-06-part-2.md`, `2026-10-13-part-3.md`.

Local dev (`pnpm dev`) shows scheduled posts early, marked "scheduled", so you
can check them. Link between parts with their permalinks, e.g.
`[part 2](/blog/2026/10/06/part-2)`; the link works from that date.

`pnpm test` checks every post's file name and title.
