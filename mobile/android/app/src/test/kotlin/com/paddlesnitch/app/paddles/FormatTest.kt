package com.paddlesnitch.app.paddles

import org.junit.Assert.assertEquals
import org.junit.Test

// The same answers the website's formatters give.
class FormatTest {
    @Test fun durationsRoundBeforeSplittingOffTheMinutes() {
        assertEquals("2:00", fmtDur(119.6))
        assertEquals("1:00", fmtDur(59.5))
        assertEquals("2:05", fmtDur(125.4))
    }

    @Test fun clockShowsHoursOnlyWhenThereAreSome() {
        assertEquals("3:05", fmtClock(185.0))
        assertEquals("1:02:05", fmtClock(3725.0))
    }

    @Test fun paceIsPer500AndADashWhenStill() {
        assertEquals("2:00", split500(500 / 119.6))
        assertEquals("—", split500(0.1))
    }

    @Test fun datesAreUtcWithFixedNames() {
        assertEquals("Sun, 13 Sep 2026", fmtWeekday("2026-09-13T07:30:00.000Z"))
        assertEquals("Sun, 13 Sep 2026", fmtWeekday("2026-09-14T00:30:00+01:00"))
        assertEquals("Sep 2026", fmtMonth("2026-09-01T07:30:00.000Z"))
        assertEquals("not a date", fmtWeekday("not a date"))
    }

    @Test fun aPaddleWithoutAMapHasNoDistance() {
        assertEquals("—", paddleKm(0.0, noGps = true))
        assertEquals("4.25 km", paddleKm(4.2478, noGps = false))
    }

    @Test fun logbookKilometres() {
        assertEquals("0", km1(0.0))
        assertEquals("6.3", km1(6.3))
    }

    // The devices pages' formatters (apps/web/src/lib/device-view.ts, packages/core/src/format.ts).
    @Test fun trackerDatesDistancesAndAges() {
        assertEquals("24 Oct 2026", fmtDay("2026-10-24T16:05:00.000Z"))
        assertEquals("4 Jul 2026, 07:30", fmtDayTime("2026-07-04T06:30:00Z", java.time.ZoneId.of("Europe/London"))) // BST: the phone's zone, not UTC
        assertEquals("84.21 km", fmtDist(84210.0))
        assertEquals("1.00 km", fmtDist(1000.0))
        assertEquals("640 m", fmtDist(640.4))
        val now = java.time.Instant.parse("2026-10-25T12:00:00Z").toEpochMilli()
        assertEquals("89s ago", fmtAgo("2026-10-25T11:58:31Z", now))
        assertEquals("2m ago", fmtAgo("2026-10-25T11:58:00Z", now))
        assertEquals("2h ago", fmtAgo("2026-10-25T09:59:00Z", now))
        assertEquals("2d ago", fmtAgo("2026-10-23T11:00:00Z", now))
        assertEquals("never", fmtAgo(null, now))
        assertEquals("0s ago", fmtAgo("2026-10-25T12:00:30Z", now)) // a clock a little ahead
        assertEquals("1m ago", fmtAgo("2026-10-25T11:58:30Z", now)) // 90 s
        assertEquals("1h ago", fmtAgo("2026-10-25T10:30:00Z", now)) // 90 m
        assertEquals("2d ago", fmtAgo("2026-10-23T12:00:00Z", now)) // 48 h
        assertEquals("never", fmtAgo("yesterday", now))
    }

    // #789: only phone: true says Phone; false or missing keeps the source's own name.
    @Test fun aPhoneSaysPhoneAndNothingElseDoes() {
        assertEquals("Phone", sourceLabel("device", true))
        assertEquals("Tracker", sourceLabel("device", false))
        assertEquals("Tracker", sourceLabel("device"))
        assertEquals("Also recorded by the phone", alsoRecordedBy("device", true))
        assertEquals("Also recorded by the tracker", alsoRecordedBy("device", false))
        assertEquals("Also recorded by Strava", alsoRecordedBy("strava"))
    }
}
