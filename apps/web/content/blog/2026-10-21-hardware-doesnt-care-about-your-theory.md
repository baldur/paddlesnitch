---
title: Hardware doesn't care about your theory
author: Baldur
image: /blog-media/2026-09-29-tracker-over-map.jpg
---

*Part 4 of 5 in a series: what 458 commits taught me about building a paddling platform (mostly by breaking it). [Part 3](/blog/2026/10/14/bugs-that-fail-quietly) was the software bugs that fail quietly.*

The tracker is a LilyGO T-Beam: GPS, a motion sensor, an SD card and Wi-Fi. After an 85-minute paddle it stopped uploading and wouldn't recover. I suspected contention on the shared bus, added a mutex and a flight recorder, and the recorder proved me wrong. Then a later build proved me partly right. The root cause was a loop reading a 10 MB file byte by byte without yielding. That wedged the SD card, which held the bus, which took the motion sensor down with it. I've left the retractions in the commit history. That's what debugging hardware actually looks like.

![A tracker held up in front of a paddle on the paddlesnitch map, the route coloured by speed](/blog-media/2026-09-29-tracker-over-map.jpg)

## The QR code that was never on screen

Setting up a tracker should be simple: scan a code to put it on your Wi-Fi, then scan another to link it to your account. On a 128-pixel screen, that turned into a week of detective work.

The first code didn't scan at all, and three separate faults were hiding behind that one symptom. The white border a scanner needs was half the standard width. A tweak to stop the screen flickering on camera was being quietly reset every time the screen redrew. And the test code pointed to a Wi-Fi network that wasn't actually switched on, so phones just gave up silently.

![The tracker's screen with a QR code drawn half over itself](/blog-media/2026-09-29-broken-qr.jpg)

Once that worked, the link code turned out never to have been visible at all. The tracker drew it, and a quarter of a second later the screen's regular refresh painted over it with a blank. It had only looked fine because the refresh happened to draw something similar. Then the screen started flickering between the code and the QR, because two processor cores were drawing to the same display and fighting over it.

![An early version of the link screen: "Link this tracker" and a six-letter code](/blog-media/2026-09-29-link-code.jpg)

It was the same root cause three times: something drawing to the screen that didn't own it. The rule now is one owner per screen, and nothing else touches the pixels. I also squeezed the link code into a smaller QR format by writing the address in capitals, which QR codes pack more tightly. The smaller code leaves more border, and it scans far more reliably.

*Next week, the last part: open source and club fleets.*
