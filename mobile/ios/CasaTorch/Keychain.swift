import Foundation
import LocalAuthentication
import Security

/// The phone's secure storage. Sign-in tokens (one per home) and each home's alert key live here, never in files.
/// Tokens can be locked behind Face ID / Touch ID (with the passcode as the fallback): then the system itself asks
/// before handing one over. Alert keys are shared with the notification extension (it decrypts alerts), so they are
/// readable after the phone's first unlock, on this device only.
enum Keychain {
    static let tokenService = "com.casatorch.token"
    static let alertKeyService = "com.casatorch.alertkey"
    /// The access group shared with the notification extension ("<team>.com.casatorch.shared"), from Info.plist.
    static var sharedGroup: String? { Bundle.main.object(forInfoDictionaryKey: "KeychainGroup") as? String }

    @discardableResult
    static func set(_ data: Data, service: String, account: String, shared: Bool = false, protectWithBiometrics: Bool = false) -> Bool {
        delete(service: service, account: account, shared: shared)
        var q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecValueData as String: data,
        ]
        if shared, let g = sharedGroup { q[kSecAttrAccessGroup as String] = g }
        if protectWithBiometrics, let ac = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly, .userPresence, nil) {
            q[kSecAttrAccessControl as String] = ac
        } else {
            q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        }
        return SecItemAdd(q as CFDictionary, nil) == errSecSuccess
    }

    /// Reads an item. For a Face ID-protected one, pass an LAContext that has already been unlocked to avoid a second prompt.
    static func get(service: String, account: String, shared: Bool = false, context: LAContext? = nil, prompt: String? = nil) -> Data? {
        var q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        if shared, let g = sharedGroup { q[kSecAttrAccessGroup as String] = g }
        let ctx = context ?? LAContext()
        if let prompt { ctx.localizedReason = prompt }
        q[kSecUseAuthenticationContext as String] = ctx
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess else { return nil }
        return out as? Data
    }

    /// Every item of a service (the extension tries each home's alert key).
    static func all(service: String, shared: Bool = false) -> [Data] {
        var q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitAll,
        ]
        if shared, let g = sharedGroup { q[kSecAttrAccessGroup as String] = g }
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess else { return [] }
        return (out as? [Data]) ?? []
    }

    static func delete(service: String, account: String, shared: Bool = false) {
        var q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
        if shared, let g = sharedGroup { q[kSecAttrAccessGroup as String] = g }
        SecItemDelete(q as CFDictionary)
    }
}
