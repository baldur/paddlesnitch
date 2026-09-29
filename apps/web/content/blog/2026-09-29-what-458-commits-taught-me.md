---
title: What 458 commits taught me about building a paddling platform (mostly by breaking it)
author: Baldur
image: /blog-media/2026-09-29-trackers.jpg
---

I paddle K1 marathon and scull on the Thames, and I've always wanted better data from my sessions than I could easily get. A GPS watch costs well over £100. A dedicated stroke coach costs over £500. And the big platforms don't really care about kayaking. Strava and Garmin are built around running and cycling, and plenty of kayakers end up recording their sessions as stand-up paddleboarding, because that's the mode that counts strokes. Then they halve the numbers in their heads.

So I started building paddlesnitch: something useful for me, and hopefully for other paddlers. You paddle a course whenever you like, upload your GPS track, and your time is verified and ranked. There's no start line and no officials, and nobody needs to be on the water the same morning. Upload any session and you get an analysis of your efforts, rests, pace and stroke rate. Alongside it I'm building a cheap open-source tracker that records GPS and boat motion and syncs over Wi-Fi.

![Four paddlesnitch trackers on a desk, each with an antenna, next to a pack of memory cards](/blog-media/2026-09-29-trackers.jpg)

I started on 16 May. Four and a half months later it's 458 commits and 319 pull requests. Here's what was hard.

## Special challenge #1: a team's worth of work, alone, in evenings

I've spent most of my career running engineering teams. Honestly assessed, what's in this repo is what I'd have expected a team of three to five engineers to take six to nine months to build. That includes a web platform, authentication, Strava integration, GPS timing, clubs and permissions, an AI coach, GDPR tooling, cloud infrastructure, CI/CD, and firmware for a custom device. I built it in four and a half months, alone, around a day job.

The difference is AI. Claude co-authored most of these commits, and later I wired it into GitHub itself: label an issue and a Claude agent picks it up, opens a draft PR, and works through review comments.

It is not magic, and it doesn't remove the engineering. It moves it. My job became deciding what to build, writing clear specs, reviewing everything, and noticing when a confident answer was wrong. The single biggest factor was a CLAUDE.md file kept honest: the conventions, the traps we'd already hit, and a rule that tests and the build must pass before anything is pushed. When the docs drifted from reality, the output drifted with them. Several recent PRs exist purely to "make the docs true again."

The tooling cost is my Claude subscription, about $90 a month, which I use for plenty besides this project. Set that against three to five engineers for six to nine months and the comparison isn't close. The test suite growing from 16 tests to over 700 is what made moving this fast safe.

## Special challenge #2: keep it cheap to run

A tracking device is always going to cost something, because hardware doesn't come free. That made me determined the software side wouldn't add much to the bill. Every architecture decision went through that filter:

- Serverless functions that cost nothing when idle.
- Plain file storage instead of an always-on database.
- Maps from a free tile provider after the paid one started demanding an API key.
- The AI coach runs locally in development and on a cheap model in production, with every call time-boxed.
- The GitHub automation moved from pay-per-token billing to a flat subscription, with a cheap scheduled triage step deciding what's worth an agent's time.

A budget alarm watches the whole account. The result is a platform that runs for about $30–40 a month in hosting. A full year of hosting everything costs less than a single stroke coach.

## The GPS was lying, and nothing complained

My first real bug was a FIT file parser that "helpfully" converted coordinates that were already in degrees, and every track landed somewhere absurd. Later, a paddler crossed the finish line on the way to the start, and the course logic happily timed that. GPS data doesn't fail loudly; it fails plausibly. Every parser now has regression tests, and failed uploads keep their full track so I can see exactly why a trace missed a gate.

## The cloud fails in silence too

Strava connections worked locally and failed in production with an error meaning "wrong secret." The secret was right. AWS was handing my function the encrypted blob instead of the value, because it lacked permission to decrypt it, and then caching that blob. Renaming the GitHub repo broke every deploy, because GitHub quietly switched to identity claims based on immutable IDs. None of these are hard problems. They're just invisible until they happen.

## My error handling hid the real bug

Some Strava athletes couldn't sign in at all. My first fix was a misdiagnosis. CloudTrail showed I was creating users with an empty username: a missing email came back as `''`, and JavaScript's `??` doesn't catch an empty string. One character, `||`, fixed it. The real lesson was that my tidy error classifier had collapsed the true exception into "unknown."

## Hardware doesn't care about your theory

The tracker is a LilyGO T-Beam: GPS, a motion sensor, an SD card and Wi-Fi. After an 85-minute paddle it stopped uploading and wouldn't recover. I suspected contention on the shared bus, added a mutex and a flight recorder, and the recorder proved me wrong. Then a later build proved me partly right. The root cause was a loop reading a 10 MB file byte by byte without yielding. That wedged the SD card, which held the bus, which took the motion sensor down with it. I've left the retractions in the commit history. That's what debugging hardware actually looks like.

![A tracker held up in front of a paddle on the paddlesnitch map, the route coloured by speed](/blog-media/2026-09-29-tracker-over-map.jpg)

## The QR code that was never on screen

Setting up a tracker should be simple: scan a code to put it on your Wi-Fi, then scan another to link it to your account. On a 128-pixel screen, that turned into a week of detective work.

The first code didn't scan at all, and three separate faults were hiding behind that one symptom. The white border a scanner needs was half the standard width. A tweak to stop the screen flickering on camera was being quietly reset every time the screen redrew. And the test code pointed to a Wi-Fi network that wasn't actually switched on, so phones just gave up silently.

![The tracker's screen with a QR code drawn half over itself](/blog-media/2026-09-29-broken-qr.jpg)

Once that worked, the link code turned out never to have been visible at all. The tracker drew it, and a quarter of a second later the screen's regular refresh painted over it with a blank. It had only looked fine because the refresh happened to draw something similar. Then the screen started flickering between the code and the QR, because two processor cores were drawing to the same display and fighting over it.

![An early version of the link screen: "Link this tracker" and a six-letter code](/blog-media/2026-09-29-link-code.jpg)

It was the same root cause three times: something drawing to the screen that didn't own it. The rule now is one owner per screen, and nothing else touches the pixels. I also squeezed the link code into a smaller QR format by writing the address in capitals, which QR codes pack more tightly. The smaller code leaves more border, and it scans far more reliably.

## Plain words are a feature

Building something you use every day makes you blind to jargon. "3 digs and 2 breathers" is now "3 hard efforts and 2 rests," and errors say what to do next. A test scans the code for retired phrases so they can't creep back.

## Open source, all of it

The web platform, the infrastructure and the tracker firmware are all public at [github.com/baldur/paddlesnitch](https://github.com/baldur/paddlesnitch). I'm building this because I want it to exist, not to lock anyone in. If you'd rather run your own version for your club, or build your own tracker, take the source and go.

## What's next: beta testers and club fleets

In October I'm onboarding five beta testers with trackers. I'm hoping for ten more in November and a hundred by the end of 2027.

![Four trackers in black cases, labelled PADDLE02 to PADDLE05](/blog-media/2026-09-29-paddle02-05.jpg)

The bigger idea is club fleets. Imagine every boat in a club's fleet carrying a small tracker. When the boats come back to the clubhouse and pick up the Wi-Fi, the sessions upload by themselves, and each athlete can review their paddle afterwards: pace, stroke rate, how the boat sat. There's no watch to buy, nothing to remember to press, and no £500 instrument per boat. That's the future I'm building toward.

If you paddle and want to race your local stretch of river, or you'd like to be a [beta tester](/?campaign=betatesters), come and find me at [paddlesnitch.com](/).
