package com.paddlesnitch.app.record

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

// `sky` columns: over the satellites used, and dual_freq means off the L1 band, not "not exactly 1575.42".
class GnssSkyTest {
    private val L1 = 1575.42e6f

    @Test fun cn0IsOverTheSatellitesUsedOnly() {
        val s = skyOf(listOf(Sat(true, 30f, L1), Sat(true, 20f, L1), Sat(false, 50f, L1)))
        assertEquals(2, s.used); assertEquals(3, s.view)
        assertEquals(25.0, s.cn0Mean!!, 1e-9)
    }

    @Test fun top4IsTheMeanOfTheFourStrongest() =
        assertEquals(35.0, skyOf(listOf(40f, 38f, 32f, 30f, 10f, 5f).map { Sat(true, it, L1) }).cn0Top4!!, 1e-9)

    @Test fun withFewerThanFourTop4IsAllOfThem() =
        assertEquals(30.0, skyOf(listOf(Sat(true, 40f, L1), Sat(true, 20f, L1))).cn0Top4!!, 1e-9)

    @Test fun noSatellitesUsedLeavesTheCellsEmpty() {
        val s = skyOf(listOf(Sat(false, 30f, L1)))
        assertEquals(0, s.used); assertEquals(1, s.view)
        assertNull(s.cn0Mean); assertNull(s.cn0Top4); assertNull(s.dualFreq)
    }

    @Test fun beidouB1AndGlonassL1AreStillL1() =
        assertEquals(false, skyOf(listOf(1561.098e6f, 1575.42e6f, 1598.0625e6f, 1605.375e6f).map { Sat(true, 30f, it) }).dualFreq)

    @Test fun l5E5AndL2AreDual() = listOf(1176.45e6f, 1207.14e6f, 1227.6e6f).forEach {
        assertEquals(true, skyOf(listOf(Sat(true, 30f, L1), Sat(true, 30f, it))).dualFreq)
    }

    @Test fun anUnusedL5SatelliteDoesntCount() =
        assertEquals(false, skyOf(listOf(Sat(true, 30f, L1), Sat(false, 30f, 1176.45e6f))).dualFreq)

    @Test fun noCarrierFrequenciesIsUnknownNotZero() = assertNull(skyOf(listOf(Sat(true, 30f, null))).dualFreq)
}
