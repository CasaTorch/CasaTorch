import CryptoKit
import Foundation
import Security
import UserNotifications

/// Opens a sealed alert on the phone. Your CasaTorch encrypted it (AES-256-GCM) with this phone's key for that home;
/// Apple, Google and casatorch.com only ever carried "New alert from your home". Here the real title and text are put
/// back before the alert shows. If it can't be opened (a key was removed), the plain notice shows instead.
final class NotificationService: UNNotificationServiceExtension {
    private var handler: ((UNNotificationContent) -> Void)?
    private var best: UNMutableNotificationContent?

    override func didReceive(_ request: UNNotificationRequest, withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void) {
        handler = contentHandler
        let content = (request.content.mutableCopy() as? UNMutableNotificationContent) ?? UNMutableNotificationContent()
        best = content
        let info = request.content.userInfo
        guard let ct = (info["ct"] as? String).flatMap({ Data(base64Encoded: $0) }), let iv = (info["iv"] as? String).flatMap({ Data(base64Encoded: $0) }), ct.count > 16 else { contentHandler(content); return }
        for key in Self.keys() {
            guard let nonce = try? AES.GCM.Nonce(data: iv), let box = try? AES.GCM.SealedBox(nonce: nonce, ciphertext: ct.dropLast(16), tag: ct.suffix(16)),
                  let plain = try? AES.GCM.open(box, using: SymmetricKey(data: key)),
                  let j = try? JSONSerialization.jsonObject(with: plain) as? [String: Any] else { continue }
            content.title = (j["title"] as? String) ?? "CasaTorch"
            content.body = (j["body"] as? String) ?? ""
            if let home = j["home"] as? String, !home.isEmpty { content.subtitle = home }
            if let hid = j["hid"] as? String { content.threadIdentifier = hid }
            var ui = content.userInfo; ui.removeValue(forKey: "ct"); ui.removeValue(forKey: "iv")
            ui["ct_url"] = j["url"] as? String ?? "/#alerts"; ui["ct_home"] = j["hid"] as? String
            content.userInfo = ui
            if (j["sev"] as? String) == "critical" { content.interruptionLevel = .timeSensitive; content.relevanceScore = 1 } else { content.interruptionLevel = .active }
            break
        }
        contentHandler(content)
    }
    override func serviceExtensionTimeWillExpire() { if let h = handler, let b = best { h(b) } }

    /// Every home's alert key on this phone (shared with the app through the Keychain group).
    static func keys() -> [Data] {
        var q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "com.casatorch.alertkey", kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitAll]
        if let g = Bundle.main.object(forInfoDictionaryKey: "KeychainGroup") as? String { q[kSecAttrAccessGroup as String] = g }
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess else { return [] }
        return ((out as? [Data]) ?? []).filter { $0.count == 32 }
    }
}
