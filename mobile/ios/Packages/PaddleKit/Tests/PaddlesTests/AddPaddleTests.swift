import Foundation
import PaddleAPI
import Testing

@testable import Paddles

/// Records each upload and answers with a canned result.
actor FakeUploads {
    private(set) var sent: [String] = []
    private let answer: Result<Analysed, PaddleAPIError>

    init(_ answer: Result<Analysed, PaddleAPIError>) {
        self.answer = answer
    }

    func upload(_ name: String, _ data: Data) throws -> Analysed {
        sent.append(name)
        return try answer.get()
    }
}

@MainActor @Suite struct AddPaddleTests {
    let file = Data("<gpx/>".utf8)

    func model(_ uploads: FakeUploads) -> AddPaddleModel {
        AddPaddleModel { name, data in try await uploads.upload(name, data) }
    }

    @Test func aNewPaddleIsAddedAndCanBeOpened() async {
        let uploads = FakeUploads(.success(Analysed(id: "pdl-new")))
        let adding = model(uploads)
        await adding.add(fileName: "Morning.gpx", data: file, signedIn: true)
        #expect(adding.state == .done(.init(message: "Paddle added.", paddleID: "pdl-new", failed: false)))
        #expect(await uploads.sent == ["Morning.gpx"])
    }

    @Test func aPaddleAlreadyThereSaysSoAndOpensTheOldOne() async {
        let adding = model(FakeUploads(.success(Analysed(duplicate: true, id: "pdl-old"))))
        await adding.add(fileName: "Morning.gpx", data: file, signedIn: true)
        #expect(
            adding.state == .done(.init(message: "That paddle was already there.", paddleID: "pdl-old", failed: false)))
    }

    @Test func aFileTheServerCannotReadSaysWhyInItsWords() async {
        let reason = "That file has too few GPS points to analyse."
        let adding = model(FakeUploads(.failure(.rejected(message: reason, status: 422, session: nil))))
        await adding.add(fileName: "Morning.gpx", data: file, signedIn: true)
        #expect(adding.state == .done(.init(message: reason, paddleID: nil, failed: true)))
    }

    @Test func aFileTooBigGetsAdviceNotAStatusCode() async {
        let adding = model(FakeUploads(.failure(.tooLarge)))
        await adding.add(fileName: "Long.gpx", data: file, signedIn: true)
        #expect(
            adding.state
                == .done(
                    .init(message: "That file is too big to add. Zip it and try again.", paddleID: nil, failed: true)))
    }

    @Test func anOutageSaysCouldntAndToTryAgain() async {
        let adding = model(FakeUploads(.failure(.badResponse(status: 502))))
        await adding.add(fileName: "Morning.gpx", data: file, signedIn: true)
        #expect(
            adding.state
                == .done(.init(message: "Couldn't add that paddle. Please try again.", paddleID: nil, failed: true)))
    }

    @Test func signedOutKeepsTheFileUntilSignInThenAddsIt() async {
        let uploads = FakeUploads(.success(Analysed(id: "pdl-new")))
        let adding = model(uploads)
        await adding.add(fileName: "Morning.gpx", data: file, signedIn: false)
        #expect(adding.state == .waitingForSignIn(fileName: "Morning.gpx"))
        #expect(await uploads.sent.isEmpty)

        await adding.signedIn()
        #expect(adding.state == .done(.init(message: "Paddle added.", paddleID: "pdl-new", failed: false)))
        #expect(await uploads.sent == ["Morning.gpx"])

        // Only once.
        await adding.signedIn()
        #expect(await uploads.sent == ["Morning.gpx"])
    }

    @Test func signingInWithNothingWaitingSendsNothing() async {
        let uploads = FakeUploads(.success(Analysed(id: "pdl-new")))
        let adding = model(uploads)
        await adding.signedIn()
        #expect(adding.state == .idle)
        #expect(await uploads.sent.isEmpty)
    }

    @Test func dismissingForgetsTheOutcomeAndAnyWaitingFile() async {
        let uploads = FakeUploads(.success(Analysed(id: "pdl-new")))
        let adding = model(uploads)
        await adding.add(fileName: "Morning.gpx", data: file, signedIn: false)
        adding.dismiss()
        #expect(adding.state == .idle)
        await adding.signedIn()
        #expect(await uploads.sent.isEmpty)
    }

    @Test func aFileThatCouldntBeReadSaysSo() {
        let adding = model(FakeUploads(.success(Analysed(id: "x"))))
        adding.couldNotRead()
        #expect(
            adding.state
                == .done(.init(message: "Couldn't open that file. Please try again.", paddleID: nil, failed: true)))
    }
}
