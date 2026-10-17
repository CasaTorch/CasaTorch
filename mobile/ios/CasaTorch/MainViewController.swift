import LocalAuthentication
import SafariServices
import UIKit
import WebKit

/// The whole app is one web view: the app's own screens (casatorch-app://app) until you're signed in, then your
/// CasaTorch itself - the same dashboard you know, fitted to the phone, with the app's extras (Face ID, alerts,
/// room scanning, haptics) through the bridge. It only ever shows your own CasaTorch: other links open in Safari.
final class MainViewController: UIViewController, WKNavigationDelegate, WKUIDelegate {
    private(set) var web: WKWebView!
    private var bridge: Bridge!
    private let refresh = UIRefreshControl()
    private var openingHome: Home?
    private var openTask: Task<Void, Never>?
    /// An alert tapped while the app was locked: opened once it's you.
    var pendingAlert: (path: String, home: String?)?
    var lock: LockOverlay?
    /// Sign-ins read since the last unlock, kept in memory only (forgotten after a while in the background).
    var tokenCache: [String: String] = [:]
    var fullscreen = false { didSet { setNeedsStatusBarAppearanceUpdate(); setNeedsUpdateOfHomeIndicatorAutoHidden() } }

    override var prefersStatusBarHidden: Bool { fullscreen }
    override var prefersHomeIndicatorAutoHidden: Bool { fullscreen }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(named: "LaunchBackground") ?? .black
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(ShellSchemeHandler(), forURLScheme: ShellSchemeHandler.scheme)
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.applicationNameForUserAgent = "CasaTorchApp/\(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1") (iOS)"
        config.limitsNavigationsToAppBoundDomains = false
        bridge = Bridge(controller: self)
        let ucc = config.userContentController
        ucc.add(WeakHandler(bridge), name: "casa")
        let info = "window.__casaInfo = \(Bridge.infoJSON());"
        ucc.addUserScript(WKUserScript(source: info, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        if let js = try? String(contentsOf: Bundle.main.resourceURL!.appendingPathComponent("shell/bridge.js"), encoding: .utf8) {
            ucc.addUserScript(WKUserScript(source: js, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        web = WKWebView(frame: view.bounds, configuration: config)
        web.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        web.navigationDelegate = self
        web.uiDelegate = self
        web.isOpaque = false
        web.backgroundColor = view.backgroundColor
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.allowsBackForwardNavigationGestures = false
        if #available(iOS 16.4, *) { web.isInspectable = false }
        refresh.addTarget(self, action: #selector(pullToRefresh), for: .valueChanged)
        web.scrollView.refreshControl = refresh
        view.addSubview(web)
        // with the Face ID lock on, the lock screen opens the home once it's you (one prompt)
        if !HomeStore.shared.biometricLock || HomeStore.shared.current == nil { start() } else { openShell("homes") }
    }

    /// First screen: your home if you have one (after Face ID), else welcome.
    func start() {
        if let h = HomeStore.shared.current { openHome(h.id) } else { openShell("welcome") }
    }
    func openShell(_ hash: String) {
        openTask?.cancel(); openTask = nil
        openingHome = nil
        web.load(URLRequest(url: URL(string: "\(ShellSchemeHandler.scheme)://app/index.html#\(hash)")!))
    }

    // MARK: - opening a home: find an address that answers, hand the web view the sign-in, load it
    func openHome(_ id: String, context: LAContext? = nil, path: String? = nil) {
        guard let home = HomeStore.shared.home(id) else { openShell("welcome"); return }
        openTask?.cancel()
        openingHome = home
        openTask = Task { @MainActor in
            // reading a Face ID-protected sign-in shows the system prompt: off the main thread
            let cached = self.tokenCache[id]
            let token = cached != nil ? cached : await Task.detached { HomeStore.shared.token(id, context: context) }.value
            if let token { self.tokenCache[id] = token }
            guard let token else {
                if HomeStore.shared.biometricLock { if let path { self.pendingAlert = (path, id) }; self.lock?.show(); return }   // Face ID was cancelled: the lock screen offers to try again
                self.openShell("signedout=\(id)"); return
            }
            guard let found = await Self.firstAnswering(home.candidates) else { if !Task.isCancelled { self.openShell("unreachable=\(id)") }; return }
            let (base, hello) = found
            HomeStore.shared.learn(id, hello: hello)   // secure access turned on since pairing: remember the away-from-home address
            guard !Task.isCancelled else { return }
            await self.setSessionCookie(token: token, for: home)
            HomeStore.shared.touch(id, workingAddress: base)
            self.web.load(URLRequest(url: path.flatMap { URL(string: $0, relativeTo: base)?.absoluteURL } ?? base))
            Push.refreshIfNeeded(home: id, base: base, token: token)
        }
    }
    /// Back from the lock: if a home is on screen, hand the sign-in back and carry on where you were; else open it.
    func resume(context: LAContext) {
        if let a = pendingAlert { pendingAlert = nil; openHome(a.home ?? HomeStore.shared.current?.id ?? "", context: context, path: a.path); return }
        if let u = web.url, u.scheme == ShellSchemeHandler.scheme, u.fragment != "homes" { return }   // pairing a phone, say: that screen stays
        guard let id = currentHomeId(), let home = HomeStore.shared.home(id), let u = web.url, u.scheme != ShellSchemeHandler.scheme else { if let h = HomeStore.shared.current { openHome(h.id, context: context) } else { start() }; return }
        Task { @MainActor in
            guard let token = await Task.detached(operation: { HomeStore.shared.token(id, context: context) }).value else { self.openShell("signedout=\(id)"); return }
            self.tokenCache[id] = token
            await self.setSessionCookie(token: token, for: home)
            _ = try? await self.web.evaluateJavaScript("window.casatorchRefresh && window.casatorchRefresh(); 1")
        }
    }
    /// Back from a short trip away: put the sign-in back from memory, no prompt.
    func openHomeQuietly(_ id: String) {
        guard let token = tokenCache[id], let home = HomeStore.shared.home(id) else { lock?.show(); lock?.unlock(); return }
        Task { @MainActor in await self.setSessionCookie(token: token, for: home); _ = try? await self.web.evaluateJavaScript("window.casatorchRefresh && window.casatorchRefresh(); 1") }
    }
    /// The first address that answers - all tried at once (home Wi-Fi first, then away-from-home), so being away
    /// doesn't mean waiting for the home addresses to time out one by one. Also returns what the home says about itself.
    static func firstAnswering(_ list: [URL]) async -> (URL, [String: Any])? {
        await withTaskGroup(of: (Int, URL, [String: Any])?.self) { g in
            for (i, u) in list.enumerated() {
                g.addTask {
                    var r = URLRequest(url: u.appendingPathComponent("api/app/hello")); r.timeoutInterval = 4; r.cachePolicy = .reloadIgnoringLocalCacheData
                    guard let (data, resp) = try? await URLSession.shared.data(for: r), (resp as? HTTPURLResponse)?.statusCode == 200,
                          let j = try? JSONSerialization.jsonObject(with: data) as? [String: Any], j["casatorch"] as? Bool == true else { return nil }
                    return (i, u, j)
                }
            }
            var best: (Int, URL, [String: Any])?
            for await r in g { if let r, best == nil || r.0 < best!.0 { best = r; if r.0 == 0 { g.cancelAll(); break } } }
            return best.map { ($0.1, $0.2) }
        }
    }
    /// The sign-in, as the cookie your CasaTorch expects, for each of the home's addresses (in memory while the app is locked).
    func setSessionCookie(token: String, for home: Home) async {
        let store = web.configuration.websiteDataStore.httpCookieStore
        for u in home.candidates {
            guard let host = u.host else { continue }
            var props: [HTTPCookiePropertyKey: Any] = [.domain: host, .path: "/", .name: "casatorch_session", .value: token, HTTPCookiePropertyKey("HttpOnly"): "TRUE", .sameSitePolicy: HTTPCookieStringPolicy.sameSiteLax]
            if u.scheme == "https" { props[.secure] = "TRUE" }
            if let c = HTTPCookie(properties: props) { await store.setCookie(c) }
        }
    }
    /// Locking: the sign-in cookies leave the web view, so nothing can be read until Face ID brings them back.
    func dropSessionCookies() async {
        let store = web.configuration.websiteDataStore.httpCookieStore
        for c in await store.allCookies() where c.name == "casatorch_session" { await store.deleteCookie(c) }
    }

    @objc private func pullToRefresh() {
        web.evaluateJavaScript("window.casatorchRefresh ? Promise.resolve(window.casatorchRefresh()).then(() => 1) : (location.reload(), 1)") { [weak self] _, _ in
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { self?.refresh.endRefreshing() }
        }
    }

    // MARK: - only your own CasaTorch in here
    private func isTrusted(_ url: URL?) -> Bool {
        guard let url else { return false }
        if url.scheme == ShellSchemeHandler.scheme { return true }
        guard let host = url.host?.lowercased() else { return false }
        return HomeStore.shared.homes.contains { $0.hosts.contains(host) } || (openingHome?.hosts.contains(host) ?? false)
    }
    func isTrustedOrigin(_ origin: WKSecurityOrigin) -> Bool {
        if origin.protocol == ShellSchemeHandler.scheme { return true }
        let host = origin.host.lowercased()
        return HomeStore.shared.homes.contains { $0.hosts.contains(host) }
    }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if url.scheme == "casatorch" { decisionHandler(.cancel); handlePairLink(url); return }
        if url.scheme == "otpauth" || url.scheme == "mailto" || url.scheme == "tel" { decisionHandler(.cancel); UIApplication.shared.open(url); return }
        if url.scheme == "about" || url.scheme == "blob" || url.scheme == "data" { decisionHandler(.allow); return }
        if isTrusted(url) {
            // The dashboard sending you to its sign-in page means this phone was signed out there.
            // (while locked the cookies are out on purpose: that isn't a sign-out, so nothing is forgotten)
            if url.path.hasSuffix("/login.html"), lock?.isLocked == true { decisionHandler(.cancel); return }
            if url.path.hasSuffix("/login.html"), action.targetFrame?.isMainFrame ?? true, let h = currentHomeId() {
                decisionHandler(.cancel); Task { await dropSessionCookies() }; Keychain.delete(service: Keychain.tokenService, account: h); openShell("signedout=\(h)"); return
            }
            decisionHandler(.allow); return
        }
        decisionHandler(.cancel)
        if action.targetFrame?.isMainFrame ?? true, ["http", "https"].contains(url.scheme ?? "") { present(SFSafariViewController(url: url), animated: true) }
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        // target=_blank: your own pages open here, anything else in Safari
        if let url = action.request.url { if isTrusted(url) { webView.load(action.request) } else if ["http", "https"].contains(url.scheme ?? "") { present(SFSafariViewController(url: url), animated: true) } }
        return nil
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if (error as NSError).code == NSURLErrorCancelled { return }
        if let h = openingHome { openShell("unreachable=\(h.id)") }
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { webView.reload() }
    // confirm() and alert() from the page, as native alerts
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        present(a, animated: true)
    }
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        present(a, animated: true)
    }
    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        let a = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
        a.addTextField { $0.text = defaultText }
        a.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(nil) })
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(a.textFields?.first?.text) })
        present(a, animated: true)
    }
    func currentHomeId() -> String? {
        guard let host = web.url?.host?.lowercased() else { return openingHome?.id }
        return HomeStore.shared.homes.first { $0.hosts.contains(host) }?.id ?? openingHome?.id
    }

    // MARK: - links from outside: a pairing QR scanned with the Camera app, an alert tapped
    func handlePairLink(_ url: URL) {
        guard url.scheme == "casatorch", url.host == "pair" else { return }
        let link = url.absoluteString.replacingOccurrences(of: "\\", with: "").replacingOccurrences(of: "'", with: "%27")
        openShell("pair=\(link.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? "")")
    }
    func openAlert(path: String, homeId: String?) {
        if lock?.isLocked == true { pendingAlert = (path, homeId); return }
        // a different home, or the app still opening: open that home straight at the alert
        guard let base = web.url, isTrusted(base), base.scheme != ShellSchemeHandler.scheme, homeId == nil || homeId == currentHomeId() else {
            if let id = homeId ?? HomeStore.shared.current?.id { openHome(id, path: path) }; return
        }
        guard let u = URL(string: path, relativeTo: base) else { return }
        web.load(URLRequest(url: u))
    }
}

/// WKUserContentController keeps its handlers strongly; this breaks the cycle.
final class WeakHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ t: WKScriptMessageHandler) { target = t }
    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) { target?.userContentController(c, didReceive: m) }
}
