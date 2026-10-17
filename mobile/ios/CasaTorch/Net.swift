import Foundation
import Network

/// Addresses that only exist inside a home network (or a private network like Tailscale). Plain http is only ever
/// used to these; anything else must be https. (The same rule as mobile/shell/shell.js and the Android app.)
func isLocalHost(_ raw: String) -> Bool {
    var h = raw.lowercased()
    if h.hasPrefix("["), h.hasSuffix("]") { h = String(h.dropFirst().dropLast()) }
    if h.hasSuffix(".") { h = String(h.dropLast()) }
    if h.isEmpty { return false }
    if h == "localhost" { return true }
    let parts = h.split(separator: ".", omittingEmptySubsequences: false)
    if parts.count == 4, parts.allSatisfy({ Int($0) != nil }) {
        let a = Int(parts[0]) ?? 0, b = Int(parts[1]) ?? 0
        return a == 10 || a == 127 || (a == 172 && (16...31).contains(b)) || (a == 192 && b == 168) || (a == 169 && b == 254) || (a == 100 && (64...127).contains(b))
    }
    if h.contains(":") { return h == "::1" || h.hasPrefix("fc") || h.hasPrefix("fd") || h.hasPrefix("fe8") || h.hasPrefix("fe9") || h.hasPrefix("fea") || h.hasPrefix("feb") }
    if !h.contains(".") { return true }
    return [".local", ".lan", ".home", ".home.arpa", ".internal", ".localdomain"].contains { h.hasSuffix($0) }
}

/// http to a home-network address, or https anywhere.
func isAllowedAddress(_ u: URL) -> Bool {
    guard let s = u.scheme?.lowercased(), let h = u.host, !h.isEmpty else { return false }
    return s == "https" || (s == "http" && isLocalHost(h))
}

/// The phone's connection: online or not, Wi-Fi or mobile data. A change (Wi-Fi to mobile data, airplane mode off…)
/// is passed on, so the app can find your home at the address that works from here.
final class Net {
    static let shared = Net()
    private let monitor = NWPathMonitor()
    private(set) var online = true
    private(set) var wifi = false
    private(set) var cellular = false
    private var lastKey = ""
    /// Called on the main thread when the connection changes (not for the first reading).
    var onChange: (() -> Void)?

    private init() {
        monitor.pathUpdateHandler = { [weak self] path in
            DispatchQueue.main.async { self?.update(path) }
        }
        monitor.start(queue: DispatchQueue(label: "com.casatorch.net"))
    }
    private func update(_ p: NWPath) {
        online = p.status == .satisfied
        wifi = p.usesInterfaceType(.wifi) || p.usesInterfaceType(.wiredEthernet)
        cellular = p.usesInterfaceType(.cellular)
        let key = "\(online)|\(wifi)|\(cellular)|\(p.availableInterfaces.map { $0.name }.joined(separator: ","))"
        guard key != lastKey else { return }
        let first = lastKey.isEmpty
        lastKey = key
        if !first { onChange?() }
    }
    var json: [String: Any] { ["online": online, "wifi": wifi, "cellular": cellular] }
}

/// "Is there a CasaTorch here?" asked by the phone itself, so the app's screens can say exactly why not:
/// offline, no such name, nothing listening, an untrusted certificate, a Wi-Fi sign-in page (a redirect)…
enum Probe {
    private final class NoRedirect: NSObject, URLSessionTaskDelegate {
        func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
            completionHandler(nil)   // a redirect is an answer in itself (usually a Wi-Fi sign-in page)
        }
    }
    private static let session: URLSession = {
        let c = URLSessionConfiguration.ephemeral
        c.requestCachePolicy = .reloadIgnoringLocalCacheData
        c.urlCache = nil
        c.httpCookieStorage = nil
        c.httpShouldSetCookies = false
        c.waitsForConnectivity = false
        return URLSession(configuration: c, delegate: NoRedirect(), delegateQueue: nil)
    }()

    /// { status, json?, net } for any answer, { error, net } when there was none.
    static func run(_ url: URL, timeout: TimeInterval) async -> [String: Any] {
        guard isAllowedAddress(url) else { return ["error": "insecure", "net": Net.shared.json] }
        var r = URLRequest(url: url)
        r.timeoutInterval = timeout
        r.setValue("application/json", forHTTPHeaderField: "Accept")
        do {
            let result = try await session.data(for: r)
            let data = result.0
            let status = (result.1 as? HTTPURLResponse)?.statusCode ?? 0
            var out: [String: Any] = ["status": status, "net": Net.shared.json]
            if data.count < 256_000, let j = try? JSONSerialization.jsonObject(with: data) as? [String: Any] { out["json"] = j }
            return out
        } catch {
            return ["error": kind(of: error, host: url.host ?? ""), "net": Net.shared.json]
        }
    }

    static func kind(of error: Error, host: String) -> String {
        guard let e = error as? URLError else { return "other" }
        switch e.code {
        // with the phone online, "offline" for a home address means iOS's Local Network permission is off
        case .notConnectedToInternet: return Net.shared.online && isLocalHost(host) ? "localnet" : "offline"
        case .dataNotAllowed, .internationalRoamingOff, .callIsActive: return "offline"
        case .timedOut: return "timeout"
        case .cannotFindHost, .dnsLookupFailed: return "dns"
        case .cannotConnectToHost, .networkConnectionLost: return "refused"
        case .secureConnectionFailed, .serverCertificateUntrusted, .serverCertificateHasBadDate, .serverCertificateNotYetValid,
             .serverCertificateHasUnknownRoot, .clientCertificateRejected, .clientCertificateRequired: return "tls"
        case .appTransportSecurityRequiresSecureConnection: return "insecure"
        default: return "other"
        }
    }
}

/// CasaTorch boxes on this network that announce themselves (Bonjour, "_casatorch._tcp" - listed under
/// NSBonjourServices in project.yml), as "http://address:port" for the app's screens to check with probe: nothing
/// found here is trusted until it answers as a CasaTorch. Never fails: no Wi-Fi, no Local Network permission or no
/// multicast just means an empty list.
enum Discover {
    private final class State<T>: @unchecked Sendable { var value: T; var done = false; init(_ v: T) { value = v } }   // used only on its own serial queue

    static func run(timeout: TimeInterval) async -> [String] {
        var out: [String] = []
        for ep in await browse(timeout: timeout).prefix(8) {   // one at a time: there's rarely more than one
            if let s = await address(of: ep, timeout: 2.5), !out.contains(s), let u = URL(string: s), isAllowedAddress(u) { out.append(s) }
        }
        return out
    }
    /// The services seen in `timeout` seconds.
    private static func browse(timeout: TimeInterval) async -> [NWEndpoint] {
        await withCheckedContinuation { (c: CheckedContinuation<[NWEndpoint], Never>) in
            let q = DispatchQueue(label: "com.casatorch.discover")
            let b = NWBrowser(for: .bonjour(type: "_casatorch._tcp", domain: "local."), using: .tcp)
            let st = State<[NWEndpoint]>([])
            let finish = { guard !st.done else { return }; st.done = true; b.cancel(); c.resume(returning: st.value) }
            b.browseResultsChangedHandler = { results, _ in st.value = results.map { $0.endpoint } }
            b.stateUpdateHandler = { state in if case .failed = state { finish() } }
            b.start(queue: q)
            q.asyncAfter(deadline: .now() + timeout) { finish() }
        }
    }
    /// A service's IPv4 address and port: connect, read where the connection went, and close it again.
    private static func address(of ep: NWEndpoint, timeout: TimeInterval) async -> String? {
        await withCheckedContinuation { (c: CheckedContinuation<String?, Never>) in
            let q = DispatchQueue(label: "com.casatorch.discover.resolve")
            let params = NWParameters.tcp
            if let ip = params.defaultProtocolStack.internetProtocol as? NWProtocolIP.Options { ip.version = .v4 }
            let conn = NWConnection(to: ep, using: params)
            let st = State<String?>(nil)
            let finish: (String?) -> Void = { s in guard !st.done else { return }; st.done = true; conn.cancel(); c.resume(returning: s) }
            conn.stateUpdateHandler = { state in
                switch state {
                case .ready:
                    if case .hostPort(let host, let port)? = conn.currentPath?.remoteEndpoint, case .ipv4(let a) = host, a.rawValue.count == 4 {
                        finish("http://\(a.rawValue.map { String($0) }.joined(separator: ".")):\(port.rawValue)")
                    } else { finish(nil) }
                case .failed, .cancelled: finish(nil)
                default: break
                }
            }
            conn.start(queue: q)
            q.asyncAfter(deadline: .now() + timeout) { finish(nil) }
        }
    }
}
