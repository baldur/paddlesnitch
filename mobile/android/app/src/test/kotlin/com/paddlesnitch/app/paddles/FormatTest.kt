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
}
