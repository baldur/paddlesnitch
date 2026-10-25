import Foundation
import Observation
import PaddleAPI

/// Adding a paddle from a GPS file: picked on the Paddles screen, or opened in
/// the app from Files, Mail or a share sheet. A file that arrives while signed
/// out waits for sign-in and is added then.
@MainActor @Observable
public final class AddPaddleModel {
    public struct Outcome: Equatable, Sendable {
        public let message: String
        /// The paddle to open: the new one, or the one that was already there.
        public let paddleID: String?
        public let failed: Bool
    }

    public enum State: Equatable, Sendable {
        case idle
        case waitingForSignIn(fileName: String)
        case adding(fileName: String)
        case done(Outcome)

        /// The card's words: also what VoiceOver reads out.
        public var announcement: String? {
            switch self {
            case .idle: nil
            // A file with no name gets plain words, never a made-up one.
            case .waitingForSignIn(let name): name.isEmpty ? "Sign in to add this paddle." : "Sign in to add \(name)."
            case .adding(let name): name.isEmpty ? "Adding your paddle…" : "Adding \(name)…"
            case .done(let outcome): outcome.message
            }
        }
    }

    public private(set) var state: State = .idle

    /// A second file waits until this one is in.
    public var isAdding: Bool {
        if case .adding = state { true } else { false }
    }

    /// What the card says, for VoiceOver to read out when it changes.
    public var announcement: String? { state.announcement }

    private let upload: @Sendable (String, Data) async throws -> Analysed
    private var waiting: (name: String, data: Data)?

    public init(upload: @escaping @Sendable (_ fileName: String, _ data: Data) async throws -> Analysed) {
        self.upload = upload
    }

    public func add(fileName: String, data: Data, signedIn: Bool) async {
        guard signedIn else {
            waiting = (fileName, data)
            state = .waitingForSignIn(fileName: fileName)
            return
        }
        waiting = nil
        state = .adding(fileName: fileName)
        do {
            // Gzip off the main thread: a long GPX can be tens of MB.
            let file = try await Task.detached { try UploadFile.prepare(name: fileName, data: data) }.value
            let added = try await upload(file.name, file.data)
            let message = added.duplicate == true ? "You've already added this paddle." : "Paddle added."
            state = .done(Outcome(message: message, paddleID: added.id, failed: false))
        } catch {
            state = .done(Outcome(message: Self.message(for: error), paddleID: nil, failed: true))
        }
    }

    /// Adds the file that was waiting for sign-in, if there is one.
    public func signedIn() async {
        guard let waiting else { return }
        await add(fileName: waiting.name, data: waiting.data, signedIn: true)
    }

    public func couldNotRead() {
        waiting = nil
        state = .done(Outcome(message: "Couldn't open that file. Please try again.", paddleID: nil, failed: true))
    }

    public func dismiss() {
        waiting = nil
        state = .idle
    }

    static func message(for error: any Error) -> String {
        switch error {
        case PaddleAPIError.rejected(let message, _, _): message
        case PaddleAPIError.tooLarge: UploadFile.tooBigMessage
        case PaddleAPIError.signedOut: "Sign in again to add a paddle."
        case is URLError: "Couldn't reach paddlesnitch. Check your connection and try again."
        default: "Couldn't add that paddle. Please try again."
        }
    }
}
