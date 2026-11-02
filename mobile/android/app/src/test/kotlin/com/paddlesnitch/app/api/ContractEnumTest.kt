package com.paddlesnitch.app.api

import org.junit.Assert.assertEquals
import org.junit.Test

// Generated enums (buildSrc/ContractModels.kt): a value from a newer server never fails decoding,
// even when the contract has its own "unknown" (TrackerSummary.firmwareState).
class ContractEnumTest {
    private fun state(wire: String) = ApiJson.decodeFromString(TrackerSummary.FirmwareState.serializer(), "\"$wire\"")

    @Test fun theContractsOwnUnknownIsAValue() = assertEquals(TrackerSummary.FirmwareState.Unknown, state("unknown"))
    @Test fun aValueFromANewerServerIsUnrecognised() = assertEquals(TrackerSummary.FirmwareState.Unrecognised, state("rolling_back"))
    @Test fun otherEnumsKeepTheirUnknown() = assertEquals(BoatClass.Unknown, ApiJson.decodeFromString(BoatClass.serializer(), "\"V12\""))
}
