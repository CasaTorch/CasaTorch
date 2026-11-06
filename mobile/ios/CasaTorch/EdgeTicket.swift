import Foundation
import WebKit

/// Edge tickets: what lets this phone through the edge gate in front of a home's secure address
/// (home-xxxxxxxx.casatorch.com) when it's away from home. Each home signs a run of them for this phone (about a week,
/// each valid 12 hours) when it signs in, pairs, or opens the home; they're kept in the Keychain, one list per home.
/// The app's own requests carry the current one as the X-CT-Gate header; the web view gets it as the __Host-ct_gate
/// cookie for the secure address only. A ticket only gets a request to the home - the home still checks the sign-in.
/// Tickets are never logged.
enum EdgeTicket {
    static let service = "com.casatorch.gate"
    struct Ticket: Codable { let t: String; let nbf: Double; let exp: Double }
    struct Store: Codable { let host: String; let tickets: [Ticket] }

    static func load(_ id: String) -> Store? {
        guard let d = Keychain.get(service: service, account: id) else { return nil }
        return try? JSONDecoder().decode(Store.self, from: d)
    }
    /// What the home handed over ({ host, tickets: [{ t, nbf, exp }] }), checked and kept.
    @discardableResult
    static func save(_ id: String, _ raw: Any?) -> Bool {
        guard let o = raw as? [String: Any], let host = (o["host"] as? String)?.lowercased(), host.range(of: "^home-[a-z0-9]{8}\\.casatorch\\.com$", options: .regularExpression) != nil,
              let list = o["tickets"] as? [[String: Any]] else { return false }
        let tickets: [Ticket] = list.prefix(32).compactMap { x in
            guard let t = x["t"] as? String, t.hasPrefix("ct1."), t.count < 1024, let nbf = x["nbf"] as? Double, let exp = x["exp"] as? Double else { return nil }
            return Ticket(t: t, nbf: nbf, exp: exp)
        }
        guard !tickets.isEmpty, let d = try? JSONEncoder().encode(Store(host: host, tickets: tickets)) else { return false }
        return Keychain.set(d, service: service, account: id)
    }
    static func remove(_ id: String) { Keychain.delete(service: service, account: id) }

    /// The ticket to use right now for this host (with a minute to spare), or nil.
    static func current(_ id: String, host: String?) -> String? {
        guard let s = load(id), let h = host?.lowercased(), h == s.host else { return nil }
        let now = Date().timeIntervalSince1970
        return s.tickets.filter { $0.nbf <= now + 60 && now < $0.exp - 60 }.sorted { $0.exp > $1.exp }.first?.t
    }
    /// The ticket for whichever home owns this host (the app's own requests: hello, probes, push).
    static func forHost(_ host: String?) -> String? {
        guard let h = host?.lowercased() else { return nil }
        for home in HomeStore.shared.homes where home.hosts.contains(h) { if let t = current(home.id, host: h) { return t } }
        return nil
    }
    /// Adds the header when the request goes to a secure address this phone has tickets for.
    static func apply(_ r: inout URLRequest) {
        if let t = forHost(r.url?.host) { r.setValue(t, forHTTPHeaderField: "X-CT-Gate") }
    }
    /// Less than three days of tickets left: time to ask for more.
    static func needsRenewal(_ id: String) -> Bool {
        guard let s = load(id) else { return true }
        return (s.tickets.map { $0.exp }.max() ?? 0) < Date().timeIntervalSince1970 + 3 * 86400
    }
    /// The web view's copy, for the secure address only (HttpOnly, Secure).
    @MainActor static func setCookie(_ id: String, store: WKHTTPCookieStore) async {
        guard let s = load(id), let t = current(id, host: s.host) else { return }
        let props: [HTTPCookiePropertyKey: Any] = [.domain: s.host, .path: "/", .name: "__Host-ct_gate", .value: t, .secure: "TRUE", HTTPCookiePropertyKey("HttpOnly"): "TRUE", .sameSitePolicy: HTTPCookieStringPolicy.sameSiteLax, .expires: Date().addingTimeInterval(11 * 3600)]
        if let c = HTTPCookie(properties: props) { await store.setCookie(c) }
    }
    /// More tickets from the home, over this phone's sign-in (at home, or through the gate with the current ticket).
    static func renew(home id: String, base: URL, token: String) {
        guard needsRenewal(id) else { return }
        var r = URLRequest(url: base.appendingPathComponent("api/gate/ticket")); r.httpMethod = "POST"; r.timeoutInterval = 10
        r.setValue("application/json", forHTTPHeaderField: "Content-Type"); r.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        r.httpBody = Data("{}".utf8)
        apply(&r)
        let req = r
        Task.detached {
            guard let res = try? await URLSession.shared.data(for: req), (res.1 as? HTTPURLResponse)?.statusCode == 200,
                  let j = try? JSONSerialization.jsonObject(with: res.0) as? [String: Any], j["active"] as? Bool == true else { return }
            EdgeTicket.save(id, j)
        }
    }
}
