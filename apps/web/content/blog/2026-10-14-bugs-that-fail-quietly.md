---
title: Bugs that fail quietly
author: Baldur
image: /blog-media/2026-09-29-trackers.jpg
---

*Part 3 of 5 in a series: what 458 commits taught me about building a paddling platform (mostly by breaking it). [Part 2](/blog/2026/10/07/keeping-it-cheap-to-run) was keeping it cheap to run.*

## The GPS was lying, and nothing complained

My first real bug was a FIT file parser that "helpfully" converted coordinates that were already in degrees, and every track landed somewhere absurd. Later, a paddler crossed the finish line on the way to the start, and the course logic happily timed that. GPS data doesn't fail loudly; it fails plausibly. Every parser now has regression tests, and failed uploads keep their full track so I can see exactly why a trace missed a gate.

## The cloud fails in silence too

Strava connections worked locally and failed in production with an error meaning "wrong secret." The secret was right. AWS was handing my function the encrypted blob instead of the value, because it lacked permission to decrypt it, and then caching that blob. Renaming the GitHub repo broke every deploy, because GitHub quietly switched to identity claims based on immutable IDs. None of these are hard problems. They're just invisible until they happen.

## My error handling hid the real bug

Some Strava athletes couldn't sign in at all. My first fix was a misdiagnosis. CloudTrail showed I was creating users with an empty username: a missing email came back as `''`, and JavaScript's `??` doesn't catch an empty string. One character, `||`, fixed it. The real lesson was that my tidy error classifier had collapsed the true exception into "unknown."

*Next week: hardware doesn't care about your theory.*
