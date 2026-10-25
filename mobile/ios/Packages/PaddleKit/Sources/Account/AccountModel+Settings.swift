import Foundation
import PaddleAPI

/// The native Account screen (mobile-apps.md, phase C5): the Terms, your
/// data, and deleting the account. The calls are in mobile/contract/README.md,
/// "Account".
extension AccountModel {
    public func termsStatus() async throws -> TosStatus {
        try await client.send(Endpoints.getAccountTos, NoInput())
    }

    /// Accepts the Terms this app was built with. A newer version on the
    /// server is a 422 (the app is out of date), in the server's words.
    public func acceptTerms() async throws {
        _ = try await client.send(Endpoints.postAccountTos, TosAccept(version: Constants.tosVersion))
        if case .signedIn(var user) = state {
            user.needsTerms = false
            profile.save(user)
            state = .signedIn(user)
        }
    }

    /// Everything we hold about you, as a file to hand to the share sheet.
    /// The server answers with a link valid for 5 minutes, so it's fetched at
    /// once. The link carries its own permission: no token goes with it.
    public func downloadData() async throws -> URL {
        let link = try await client.send(Endpoints.accountExport, NoInput())
        // Not the link itself in the error: it opens the export for 5 minutes.
        guard let url = Self.resolve(link.url, against: client.baseURL) else {
            throw PaddleAPIError.undecodable("export link")
        }
        let (data, response) = try await client.transport.send(URLRequest(url: url))
        guard (200..<300).contains(response.statusCode) else {
            throw PaddleAPIError.badResponse(status: response.statusCode)
        }
        removeDownloadedData()
        let day = Date().formatted(.iso8601.year().month().day())
        let file = Self.downloads.appending(path: "paddlesnitch-data-\(day).json")
        try data.write(to: file, options: Self.protected)
        return file
    }

    /// The export is everything we hold about you: removed once the share
    /// sheet has copied it, and on deleting the account or signing out.
    public func removeDownloadedData() {
        let files =
            (try? FileManager.default.contentsOfDirectory(at: Self.downloads, includingPropertiesForKeys: nil)) ?? []
        for file in files where file.lastPathComponent.hasPrefix("paddlesnitch-data") {
            try? FileManager.default.removeItem(at: file)
        }
    }

    static var downloads: URL { FileManager.default.temporaryDirectory }

    /// Readable only while the phone is unlocked. (macOS, where the package
    /// tests run, has no such protection and refuses the option.)
    #if os(iOS)
        static let protected: Data.WritingOptions = [.atomic, .completeFileProtection]
    #else
        static let protected: Data.WritingOptions = [.atomic]
    #endif

    /// In local dev the link is relative to the site.
    static func resolve(_ link: String, against base: URL) -> URL? {
        URL(string: link, relativeTo: base)?.absoluteURL
    }

    /// Erases the account. The refresh token goes with the request so it
    /// stops working; only once the server has done it are the tokens
    /// dropped here. A failure leaves you signed in.
    public func deleteAccount() async throws {
        let refreshToken = await session.refreshToken
        _ = try await client.send(Endpoints.deleteAccount, DeleteAccount(refreshToken: refreshToken))
        _ = await session.signOut()
        profile.clear()
        removeDownloadedData()
        accountDeleted = true
        state = .signedOut
    }
}
