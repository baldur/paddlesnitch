import Foundation
import Security

/// Where the refresh token lives between launches. The ID token is only ever
/// held in memory.
public protocol TokenStore: Sendable {
    func load() -> String?
    /// Throws if the token can't be kept: better to say so at sign-in than
    /// to sign in and lose it on the first call.
    func save(_ refreshToken: String) throws
    func clear()
}

public struct TokenStoreError: Error, Equatable {
    /// The Keychain's own status, e.g. -34018 for an app missing its
    /// Keychain entitlement (an unsigned build).
    public let status: OSStatus
}

/// For tests and previews.
public final class MemoryTokenStore: TokenStore, @unchecked Sendable {
    private let lock = NSLock()
    private var token: String?

    public init(_ token: String? = nil) {
        self.token = token
    }

    public func load() -> String? { lock.withLock { token } }
    public func save(_ refreshToken: String) { lock.withLock { token = refreshToken } }
    public func clear() { lock.withLock { token = nil } }
}

/// The refresh token in the Keychain: this device only, readable after the
/// first unlock (so a background sync can refresh), never in a backup.
public struct KeychainTokenStore: TokenStore {
    let service: String

    public init(service: String = "com.paddlesnitch.app.refresh-token") {
        self.service = service
    }

    private var query: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
            kSecAttrAccount as String: "refresh",
        ]
    }

    public func load() -> String? {
        var item: CFTypeRef?
        var search = query
        search[kSecReturnData as String] = true
        search[kSecMatchLimit as String] = kSecMatchLimitOne
        guard SecItemCopyMatching(search as CFDictionary, &item) == errSecSuccess, let data = item as? Data else {
            return nil
        }
        return String(bytes: data, encoding: .utf8)
    }

    public func save(_ refreshToken: String) throws {
        clear()
        var item = query
        item[kSecValueData as String] = Data(refreshToken.utf8)
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(item as CFDictionary, nil)
        guard status == errSecSuccess else { throw TokenStoreError(status: status) }
    }

    public func clear() {
        SecItemDelete(query as CFDictionary)
    }
}
