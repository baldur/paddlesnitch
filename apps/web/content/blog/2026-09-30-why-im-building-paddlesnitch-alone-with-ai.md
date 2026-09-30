---
title: Why I'm building paddlesnitch, alone, with AI
author: Baldur
image: /blog-media/2026-09-29-trackers.jpg
---

*Part 1 of 5 in a series: what 458 commits taught me about building a paddling platform (mostly by breaking it).*

I paddle K1 marathon and scull on the Thames, and I've always wanted better data from my sessions than I could easily get. A GPS watch costs well over £100. A dedicated stroke coach costs over £500. And the big platforms don't really care about kayaking. Strava and Garmin are built around running and cycling, and plenty of kayakers end up recording their sessions as stand-up paddleboarding, because that's the mode that counts strokes. Then they halve the numbers in their heads.

So I started building paddlesnitch: something useful for me, and hopefully for other paddlers. You paddle a course whenever you like, upload your GPS track, and your time is verified and ranked. There's no start line and no officials, and nobody needs to be on the water the same morning. Upload any session and you get an analysis of your efforts, rests, pace and stroke rate. Alongside it I'm building a cheap open-source tracker that records GPS and boat motion and syncs over Wi-Fi.

![Four paddlesnitch trackers on a desk, each with an antenna, next to a pack of memory cards](/blog-media/2026-09-29-trackers.jpg)

I started on 16 May. By late September it was 458 commits and 319 pull requests. Over five weekly posts, here's what was hard.

## A team's worth of work, alone, in evenings

I've spent most of my career running engineering teams. Honestly assessed, what's in this repo is what I'd have expected a team of three to five engineers to take six to nine months to build. That includes a web platform, authentication, Strava integration, GPS timing, clubs and permissions, an AI coach, GDPR tooling, cloud infrastructure, CI/CD, and firmware for a custom device. I built it in four and a half months, alone, around a day job.

The difference is AI. Claude co-authored most of these commits, and later I wired it into GitHub itself: label an issue and a Claude agent picks it up, opens a draft PR, and works through review comments.

It is not magic, and it doesn't remove the engineering. It moves it. My job became deciding what to build, writing clear specs, reviewing everything, and noticing when a confident answer was wrong. The single biggest factor was a CLAUDE.md file kept honest: the conventions, the traps we'd already hit, and a rule that tests and the build must pass before anything is pushed. When the docs drifted from reality, the output drifted with them. Several recent PRs exist purely to "make the docs true again."

The tooling cost is my Claude subscription, about $90 a month, which I use for plenty besides this project. Set that against three to five engineers for six to nine months and the comparison isn't close. The test suite growing from 16 tests to over 700 is what made moving this fast safe.

*Next week: keeping it cheap to run.*
