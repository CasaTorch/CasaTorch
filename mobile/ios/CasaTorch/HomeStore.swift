import Foundation
import LocalAuthentication

/// A home this phone is signed in to. The list (names, addresses) is kept in the app's settings; the sign-in token is
/// in the Keychain. No account anywhere else: a home is just your own CasaTorch.
struct Home: Codable, Equatable {
    struct User: Codable, Equatable { var name: String?; var role: String? }
    struct Addresses: Codable, Equatable { var lan: String?; var remote: String?; var plain: String?; var here: String? }
    var id: String
    var name: String
    var user: User?
    var addresses: Addresses
    var last: Date?
    /// The address that worked last time comes first, then the secure one at home, then from anywhere, then plain.
    var candidates: [URL] {
        var seen = Set<String>(), out: [URL] = []
        for s in [addresses.here, addresses.lan, addresses.remote, addresses.plain].compactMap({ $0 }) where !seen.contains(s) {
            seen.insert(s); if let u = URL(string: s), u.scheme == "https" || u.scheme == "http" { out.append(u) }
        }
        return out
    }
    var hosts: Set<String> { Set(candidates.compactMap { $0.host?.lowercased() }) }
}

final class HomeStore {
    static let shared = HomeStore()
    private let key = "casatorch.homes", currentKey = "casatorch.currentHome", lockKey = "casatorch.biometricLock"
    private(set) var homes: [Home] = []
    private init() { load() }

    private func load() {
        if let d = UserDefaults.standard.data(forKey: key), let list = try? JSONDecoder().decode([Home].self, from: d) { homes = list }
    }
    private func save() { if let d = try? JSONEncoder().encode(homes) { UserDefaults.standard.set(d, forKey: key) } }

    var currentId: String? {
        get { UserDefaults.standard.string(forKey: currentKey) }
        set { UserDefaults.standard.set(newValue, forKey: currentKey) }
    }
    var current: Home? { homes.first { $0.id == currentId } ?? homes.first }
    func home(_ id: String) -> Home? { homes.first { $0.id == id } }

    /// Face ID lock for the whole app (and the tokens behind it).
    var biometricLock: Bool {
        get { UserDefaults.standard.bool(forKey: lockKey) }
        set { UserDefaults.standard.set(newValue, forKey: lockKey) }
    }

    func upsert(_ h: Home, token: String) -> Bool {
        if let i = homes.firstIndex(where: { $0.id == h.id }) { homes[i] = h } else { homes.append(h) }
        currentId = h.id; save()
        return Keychain.set(Data(token.utf8), service: Keychain.tokenService, account: h.id, protectWithBiometrics: biometricLock)
    }
    func touch(_ id: String, workingAddress: URL?) {
        guard let i = homes.firstIndex(where: { $0.id == id }) else { return }
        homes[i].last = Date()
        if let a = workingAddress { homes[i].addresses.here = "\(a.scheme ?? "https")://\(a.host ?? "")\(a.port.map { ":\($0)" } ?? "")" }
        currentId = id; save()
    }
    /// The home told us its addresses (only trusted when it's the same home): keep them current.
    func learn(_ id: String, hello: [String: Any]) {
        guard let i = homes.firstIndex(where: { $0.id == id }), (hello["home"] as? [String: Any])?["id"] as? String == id else { return }
        let ok: (Any?) -> String? = { v in guard let s = v as? String, let u = URL(string: s), u.scheme == "https", u.host != nil else { return nil }; return s }
        var changed = false
        if let r = ok(hello["remote"]), homes[i].addresses.remote != r { homes[i].addresses.remote = r; changed = true }
        if let l = ok(hello["secure"]), homes[i].addresses.lan != l { homes[i].addresses.lan = l; changed = true }
        if changed { save() }
    }
    func remove(_ id: String) {
        homes.removeAll { $0.id == id }; save()
        Keychain.delete(service: Keychain.tokenService, account: id)
        Keychain.delete(service: Keychain.alertKeyService, account: id, shared: true)
        UserDefaults.standard.removeObject(forKey: Push.homeKey(id))
        if currentId == id { currentId = homes.first?.id }
    }
    func token(_ id: String, context: LAContext? = nil) -> String? {
        guard let d = Keychain.get(service: Keychain.tokenService, account: id, context: context, prompt: "Unlock CasaTorch") else { return nil }
        return String(data: d, encoding: .utf8)
    }
    /// Turning the Face ID lock on or off re-saves every token with (or without) the protection.
    func reprotect(context: LAContext?) {
        for h in homes { if let t = token(h.id, context: context) { Keychain.set(Data(t.utf8), service: Keychain.tokenService, account: h.id, protectWithBiometrics: biometricLock) } }
    }
    /// Each home's alert key: made on this phone, given only to that home, shared with the notification extension.
    func alertKey(for id: String) -> Data {
        if let k = Keychain.get(service: Keychain.alertKeyService, account: id, shared: true), k.count == 32 { return k }
        var k = Data(count: 32)
        _ = k.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, 32, $0.baseAddress!) }
        Keychain.set(k, service: Keychain.alertKeyService, account: id, shared: true)
        return k
    }
}
