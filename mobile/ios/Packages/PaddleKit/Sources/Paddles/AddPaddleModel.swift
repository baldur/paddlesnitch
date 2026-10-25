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
    }

    public private(set) var state: State = .idle

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
            let added = try await upload(fileName, data)
            let message = added.duplicate == true ? "That paddle was already there." : "Paddle added."
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
        case PaddleAPIError.tooLarge: "That file is too big to add. Zip it and try again."
        case PaddleAPIError.signedOut: "Sign in again to add a paddle."
        case is URLError: "Couldn't reach paddlesnitch. Check your connection and try again."
        default: "Couldn't add that paddle. Please try again."
        }
    }
}
