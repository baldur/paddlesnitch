---
title: Keeping it cheap to run
author: Baldur
image: /blog-media/2026-09-29-trackers.jpg
---

*Part 2 of 5 in a series: what 458 commits taught me about building a paddling platform (mostly by breaking it). [Part 1](/blog/2026/09/30/why-im-building-paddlesnitch-alone-with-ai) was why I started, and how one person builds this with AI.*

A tracking device is always going to cost something, because hardware doesn't come free. That made me determined the software side wouldn't add much to the bill. Every architecture decision went through that filter:

- Serverless functions that cost nothing when idle.
- Plain file storage instead of an always-on database.
- Maps from a free tile provider after the paid one started demanding an API key.
- The AI coach runs locally in development and on a cheap model in production, with every call time-boxed.
- The GitHub automation moved from pay-per-token billing to a flat subscription, with a cheap scheduled triage step deciding what's worth an agent's time.

A budget alarm watches the whole account. The result is a platform that runs for about $30–40 a month in hosting. A full year of hosting everything costs less than a single stroke coach.

*Next week: bugs that fail quietly.*
