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

A post goes live when it is merged to `main` (the pages are built at deploy).
`pnpm test` checks every post's file name and title.
