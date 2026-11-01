import Foundation

/// What the uploader remembers for one account on this phone, kept with
/// the account's recordings (`uploads.json`, out of backups with them).
public struct UploadState: Codable, Equatable, Sendable {
    /// This phone on the account (`POST /api/account/devices/phone`).
    public var deviceID: String?
    /// The owner removed this phone on Devices (404): nothing uploads until
    /// they tap Upload now or start a recording.
    public var removed = false
    /// Recordings the server will never take: kept, never retried by itself.
    public var refused: [String] = []
    /// Tracks with no GPS fix at all: the server kept nothing, and the line
    /// says so until dismissed.
    public var noFix: [String] = []
    /// Files that already had one sha256 mismatch: a second is a dead end,
    /// in this pass or a later one.
    public var mismatched: [String] = []

    public init() {}

    public init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        deviceID = try values.decodeIfPresent(String.self, forKey: .deviceID)
        removed = try values.decodeIfPresent(Bool.self, forKey: .removed) ?? false
        refused = try values.decodeIfPresent([String].self, forKey: .refused) ?? []
        noFix = try values.decodeIfPresent([String].self, forKey: .noFix) ?? []
        mismatched = try values.decodeIfPresent([String].self, forKey: .mismatched) ?? []
    }

    static func file(in folder: URL) -> URL { folder.appending(path: "uploads.json") }

    public static func load(from folder: URL) -> UploadState {
        guard let data = try? Data(contentsOf: file(in: folder)) else { return UploadState() }
        return (try? JSONDecoder().decode(UploadState.self, from: data)) ?? UploadState()
    }

    /// Only into a folder that's there: never brings back one deleted with
    /// its account. Out of backups like the recordings, and readable by a
    /// background upload once the phone has been unlocked.
    func save(to folder: URL) throws {
        guard FileManager.default.fileExists(atPath: folder.path(percentEncoded: false)) else { return }
        var excluded = folder
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try excluded.setResourceValues(values)
        try JSONEncoder().encode(self).write(
            to: Self.file(in: folder), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
}

/// A random ID made once per install, kept with the app's own settings
/// (never the advertising or a hardware ID): the server gives the same
/// install and account the same phone. Deleting the app makes a new one.
public enum InstallID {
    static let key = "phoneInstallID"
    static let characters = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789")

    public static func current(in defaults: UserDefaults = .standard) -> String {
        if let id = defaults.string(forKey: key), valid(id) { return id }
        var generator = SystemRandomNumberGenerator()
        let id = String((0..<32).map { _ in characters[Int.random(in: 0..<characters.count, using: &generator)] })
        defaults.set(id, forKey: key)
        return id
    }

    /// The server's rule: 16–64 of `A–Z a–z 0–9 _ -`.
    static func valid(_ id: String) -> Bool {
        (16...64).contains(id.count)
            && id.unicodeScalars.allSatisfy {
                CharacterSet.alphanumerics.contains($0) && $0.isASCII || "_-".unicodeScalars.contains($0)
            }
    }
}
