import Foundation
import PaddleAPI
import Testing

@testable import Paddles

/// mobile/contract/README.md, "Same outing".
@MainActor @Suite struct SameOutingTests {
    func links(_ source: ScriptedSource) async -> (PaddleDetailModel, [SameOutingLink]) {
        let model = PaddleDetailModel(id: "pdl-river", source: source)
        await model.load()
        return (model, model.sameOuting)
    }

    @Test func thePageLinksEachOtherRecording() async {
        let (_, links) = await links(ScriptedSource(sameOuting: "paddles.sameOuting"))
        #expect(links == [SameOutingLink(id: "pdl-phone2", sourceType: "device", phone: true)])
        #expect(links.first?.text == "Also recorded by the phone")
        #expect(links.first?.spoken == "Compare with the recording from the phone")
    }

    @Test func noOtherRecordingsShowNothing() async {
        let (model, links) = await links(ScriptedSource(sameOuting: "paddles.sameOuting.none"))
        #expect(links.isEmpty)
        #expect(model.state.value != nil)
    }

    @Test func aFailedCallShowsNothingAndThePageStays() async {
        let (model, links) = await links(ScriptedSource(sameOuting: nil))
        #expect(links.isEmpty)
        #expect(model.state.value != nil, "the links are extra, never an error on the page")
    }

    @Test func aTrackerRecordingIsTheTracker() {
        #expect(SameOutingLink(id: "b", sourceType: "device", phone: nil).text == "Also recorded by the tracker")
    }

    @Test func compareHasThePaddleOnScreenFirst() {
        #expect(
            SameOutingLink.comparePath(a: "pdl-tracker", b: "pdl-phone2")
                == "/paddles/compare?a=pdl-tracker&b=pdl-phone2")
    }

    /// The samples have no account to compare in.
    @Test func theSamplesHaveNoLinks() async throws {
        #expect(try await SamplePaddles(directory: fixtures).sameOuting(id: "pdl-river").isEmpty)
    }
}
