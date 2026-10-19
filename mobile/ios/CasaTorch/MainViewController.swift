import LocalAuthentication
import SafariServices
import UIKit
import WebKit

/// The whole app is one web view: the app's own screens (casatorch-app://app) until you're signed in, then your
/// CasaTorch itself - the same dashboard you know, fitted to the phone, with the app's extras (Face ID, alerts,
/// room scanning, haptics) through the bridge. It only ever shows your own CasaTorch: other links open in Safari.
final class MainViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, UIGestureRecognizerDelegate {
    private(set) var web: WKWebView!
    private var bridge: Bridge!
    private let refresh = UIRefreshControl()
    private var openingHome: Home?
    private var openTask: Task<Void, Never>?
    private var recheckTask: Task<Void, Never>?
    private var shown = false
    /// An alert tapped while the app was locked: opened once it's you.
    var pendingAlert: (path: String, home: String?)?
    var lock: LockOverlay?
    /// Sign-ins read since the last unlock, kept in memory only (forgotten after a while in the background).
    var tokenCache: [String: String] = [:]
    /// The Face ID check that just unlocked the app, so opening the home picked at launch doesn't ask twice.
    var unlockContext: LAContext?
    var fullscreen = false { didSet { setNeedsStatusBarAppearanceUpdate(); setNeedsUpdateOfHomeIndicatorAutoHidden() } }

    override var prefersStatusBarHidden: Bool { fullscreen }
    override var prefersHomeIndicatorAutoHidden: Bool { fullscreen }
    private var onShell: Bool { web.url?.scheme == ShellSchemeHandler.scheme }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(named: "LaunchBackground") ?? .black
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(ShellSchemeHandler(), forURLScheme: ShellSchemeHandler.scheme)
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.applicationNameForUserAgent = "CasaTorchApp/\(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1") (iOS)"
        config.limitsNavigationsToAppBoundDomains = false
        config.dataDetectorTypes = []
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
        web.scrollView.backgroundColor = view.backgroundColor
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.allowsBackForwardNavigationGestures = false
        web.alpha = 0   // shown once the first page has drawn: no white flash
        #if DEBUG
        if #available(iOS 16.4, *) { web.isInspectable = true }
        #else
        if #available(iOS 16.4, *) { web.isInspectable = false }
        #endif
        refresh.addTarget(self, action: #selector(pullToRefresh), for: .valueChanged)
        view.addSubview(web)
        // the app's own screens: a swipe from the left edge goes back (as on any iPhone screen)
        let edge = UIScreenEdgePanGestureRecognizer(target: self, action: #selector(edgeSwipe(_:)))
        edge.edges = .left; edge.delegate = self
        view.addGestureRecognizer(edge)
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) { [weak self] in self?.reveal() }   // never a blank screen, even if a page hangs
        Net.shared.onChange = { [weak self] in self?.networkChanged() }
        // with the Face ID lock on, the lock screen opens the home once it's you (one prompt)
        if !HomeStore.shared.biometricLock || HomeStore.shared.current == nil { start() } else { openShell("homes") }
    }

    private func reveal() {
        guard !shown else { return }
        shown = true
        UIView.animate(withDuration: 0.22) { self.web.alpha = 1 }
    }

    /// First screen: your home if you have one (after Face ID), else welcome. More than one home and no remembered
    /// choice: which one to open.
    func start() {
        if HomeStore.shared.shouldAskAtLaunch { openShell("choose"); return }
        if let h = HomeStore.shared.launchHomeId.flatMap({ HomeStore.shared.home($0) }) ?? HomeStore.shared.current { openHome(h.id) } else { openShell("welcome") }
    }
    func openShell(_ hash: String) {
        openTask?.cancel(); openTask = nil
        recheckTask?.cancel(); recheckTask = nil
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
            let cached = self.tokenCache[id], ctx = context ?? self.unlockContext
            let token = cached != nil ? cached : await Task.detached { HomeStore.shared.token(id, context: ctx) }.value
            if let token { self.tokenCache[id] = token }
            guard let token else {
                if HomeStore.shared.biometricLock { if let path { self.pendingAlert = (path, id) }; self.lock?.show(); return }   // Face ID was cancelled: the lock screen offers to try again
                self.openShell("signedout=\(id)"); return
            }
            guard let found = await Self.firstAnswering(home.candidates) else { if !Task.isCancelled { self.openShell("unreachable=\(id)") }; return }
            let base = found.0
            HomeStore.shared.learn(id, hello: found.1)   // secure access turned on (or off) since pairing: remember (or forget) the away-from-home address
            guard !Task.isCancelled else { return }
            await self.setSessionCookie(token: token, for: HomeStore.shared.home(id) ?? home, at: base)   // with what it just learned: the sign-in goes to the secure address too
            HomeStore.shared.touch(id, workingAddress: base)
            self.web.load(URLRequest(url: path.flatMap { URL(string: $0, relativeTo: base)?.absoluteURL } ?? base))
            Push.refreshIfNeeded(home: id, base: base, token: token)
        }
    }
    /// Back from the lock: if a home is on screen, hand the sign-in back and carry on where you were; else open it.
    func resume(context: LAContext) {
        unlockContext = context
        if let a = pendingAlert { pendingAlert = nil; openHome(a.home ?? HomeStore.shared.current?.id ?? "", context: context, path: a.path); return }
        if let u = web.url, u.scheme == ShellSchemeHandler.scheme, u.fragment != "homes" { return }   // pairing a phone, say: that screen stays
        guard let id = currentHomeId(), let home = HomeStore.shared.home(id), let u = web.url, u.scheme != ShellSchemeHandler.scheme else {
            if HomeStore.shared.shouldAskAtLaunch { openShell("choose") } else if let h = HomeStore.shared.launchHomeId.flatMap({ HomeStore.shared.home($0) }) ?? HomeStore.shared.current { openHome(h.id, context: context) } else { start() }
            return
        }
        Task { @MainActor in
            guard let token = await Task.detached(operation: { HomeStore.shared.token(id, context: context) }).value else { self.openShell("signedout=\(id)"); return }
            self.tokenCache[id] = token
            await self.setSessionCookie(token: token, for: home, at: u)
            _ = try? await self.web.evaluateJavaScript("window.casatorchRefresh && window.casatorchRefresh(); 1")
            self.recheckHome(after: 0.2)
        }
    }
    /// Back from a short trip away: put the sign-in back from memory, no prompt.
    func openHomeQuietly(_ id: String) {
        guard let token = tokenCache[id], let home = HomeStore.shared.home(id) else { lock?.show(); lock?.unlock(); return }
        Task { @MainActor in await self.setSessionCookie(token: token, for: home); _ = try? await self.web.evaluateJavaScript("window.casatorchRefresh && window.casatorchRefresh(); 1") }
    }
    /// The first address that answers - all tried at once (home Wi-Fi first, then away-from-home), so being away
    /// doesn't mean waiting for the home addresses to time out one by one. Also returns what the home says about itself.
    /// https addresses come first, so a plain-http address is used only when none of them answers.
    static func firstAnswering(_ list: [URL], timeout: TimeInterval = 4) async -> (URL, [String: Any])? {
        let ok = list.filter(isAllowedAddress)
        let allowed = ok.filter { $0.scheme?.lowercased() == "https" } + ok.filter { $0.scheme?.lowercased() != "https" }
        return await withTaskGroup(of: (Int, URL, [String: Any])?.self) { g in
            for (i, u) in allowed.enumerated() {
                g.addTask {
                    var r = URLRequest(url: u.appendingPathComponent("api/app/hello")); r.timeoutInterval = timeout; r.cachePolicy = .reloadIgnoringLocalCacheData
                    guard let res = try? await URLSession.shared.data(for: r), (res.1 as? HTTPURLResponse)?.statusCode == 200,
                          let j = try? JSONSerialization.jsonObject(with: res.0) as? [String: Any], j["casatorch"] as? Bool == true else { return nil }
                    return (i, u, j)
                }
            }
            var best: (Int, URL, [String: Any])?
            for await r in g {
                guard let r else { continue }
                if best == nil || r.0 < (best?.0 ?? Int.max) { best = r }
                if r.0 == 0 { g.cancelAll(); break }
            }
            return best.map { ($0.1, $0.2) }
        }
    }
    /// The sign-in, as the cookie your CasaTorch expects (in memory while the app is locked). `base` is the address the
    /// home is (being) opened at. Open at an https address (the secure one at home, or from anywhere): only the https
    /// addresses get it, as a Secure cookie, and a copy left on a plain-http address is taken back - so it's never sent
    /// unencrypted while an encrypted address answers. Open at its plain address (no https address answered), or not
    /// known: every address gets it, as before.
    func setSessionCookie(token: String, for home: Home, at base: URL? = nil) async {
        let store = web.configuration.websiteDataStore.httpCookieStore
        let open = base ?? web.url.flatMap { $0.scheme == ShellSchemeHandler.scheme ? nil : $0 } ?? HomeStore.shared.home(home.id)?.addresses.here.flatMap { URL(string: $0) }
        let secure = home.candidates.filter { $0.scheme?.lowercased() == "https" }, plain = home.candidates.filter { $0.scheme?.lowercased() != "https" }
        var list = secure + plain
        if open?.scheme?.lowercased() == "https" {
            list = secure
            let secureHosts = Set(secure.compactMap { $0.host?.lowercased() })
            let plainOnly = Set(plain.compactMap { $0.host?.lowercased() }).subtracting(secureHosts)
            for c in await store.allCookies() where c.name == "casatorch_session" && plainOnly.contains(c.domain.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "."))) { await store.deleteCookie(c) }
        }
        for u in list {
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

    // MARK: - the network changed, or the app is back: keep the home at an address that works from here
    func networkChanged() {
        // the page hears it at once: the app's own screens try again; your home drops the requests and the live
        // stream left on the old connection (dead, but nothing says so) and asks again on the new one
        let j = (try? JSONSerialization.data(withJSONObject: Net.shared.json)).flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
        web.evaluateJavaScript("window.__casaEvent && window.__casaEvent('network', \(j)); 1", completionHandler: nil)
        if onShell { return }
        recheckHome(after: 1.5, rerace: true)   // let the new connection settle (Wi-Fi to mobile data takes a moment)
    }
    /// Called by the scene when the app comes back to the screen.
    func cameBack(after away: TimeInterval) {
        web.evaluateJavaScript("window.__casaEvent && window.__casaEvent('resume', {}); 1", completionHandler: nil)
        if away > 20 { recheckHome(after: 0.3) }
    }
    /// A home is on screen: still answering at this address? If not, the best address that does (say, from
    /// anywhere instead of the home Wi-Fi), on the same page. If none does, "can't reach", which keeps trying.
    /// After a network change (`rerace`) the addresses are raced again even when this one still answers: back on the
    /// home Wi-Fi, the home address (much faster than going out and back in through secure access) takes over.
    func recheckHome(after delay: Double, rerace: Bool = false) {
        guard lock?.isLocked != true, let cur = web.url, cur.scheme != ShellSchemeHandler.scheme, let id = currentHomeId(), let home = HomeStore.shared.home(id), let here = Home.originString(cur), let hereURL = URL(string: here) else { return }
        recheckTask?.cancel()
        recheckTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            guard !Task.isCancelled else { return }
            let hereOK = await Self.firstAnswering([hereURL], timeout: 3) != nil
            if hereOK && !rerace { return }   // still fine where it is
            let order = rerace ? home.raceOrder : home.candidates
            var found = await Self.firstAnswering(order)
            if found == nil, !hereOK, !Task.isCancelled { try? await Task.sleep(nanoseconds: 3_000_000_000); found = await Self.firstAnswering(order) }
            guard !Task.isCancelled, let now = self.web.url, Home.originString(now) == here else { return }   // you moved on meanwhile
            guard let found else { if !hereOK { self.openShell("unreachable=\(id)") }; return }
            guard let base = Home.originString(found.0), base != here else { return }
            HomeStore.shared.learn(id, hello: found.1)
            HomeStore.shared.touch(id, workingAddress: found.0)
            if let token = self.tokenCache[id] { await self.setSessionCookie(token: token, for: HomeStore.shared.home(id) ?? home, at: found.0) }
            let c = URLComponents(url: now, resolvingAgainstBaseURL: false)
            let tail = (c?.percentEncodedPath.isEmpty == false ? c?.percentEncodedPath ?? "/" : "/") + (c?.percentEncodedQuery.map { "?\($0)" } ?? "") + (c?.percentEncodedFragment.map { "#\($0)" } ?? "")
            self.web.load(URLRequest(url: URL(string: base + tail) ?? found.0))
        }
    }

    @objc private func pullToRefresh() {
        web.evaluateJavaScript("window.casatorchRefresh ? Promise.resolve(window.casatorchRefresh()).then(() => 1) : (location.reload(), 1)") { [weak self] _, _ in
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { self?.refresh.endRefreshing() }
        }
    }
    @objc private func edgeSwipe(_ g: UIScreenEdgePanGestureRecognizer) {
        guard g.state == .recognized || g.state == .ended, onShell else { return }
        web.evaluateJavaScript("window.__casaBack ? window.__casaBack() : false", completionHandler: nil)
    }
    func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }
    func gestureRecognizerShouldBegin(_ g: UIGestureRecognizer) -> Bool { !(g is UIScreenEdgePanGestureRecognizer) || onShell }

    // MARK: - a keyboard on iPad: ⌘R reloads, ⌘[ goes back
    override var keyCommands: [UIKeyCommand]? {
        [UIKeyCommand(title: "Reload", action: #selector(reloadKey), input: "r", modifierFlags: .command),
         UIKeyCommand(title: "Back", action: #selector(backKey), input: "[", modifierFlags: .command),
         UIKeyCommand(title: "Your Homes", action: #selector(homesKey), input: "h", modifierFlags: [.command, .shift])]
    }
    @objc private func reloadKey() { if onShell { web.reload() } else { pullToRefresh() } }
    @objc private func backKey() { if onShell { web.evaluateJavaScript("window.__casaBack && window.__casaBack()", completionHandler: nil) } else if web.canGoBack { web.goBack() } }
    @objc private func homesKey() { if lock?.isLocked != true { openShell("homes") } }

    // MARK: - only your own CasaTorch in here
    private func isTrusted(_ url: URL?) -> Bool {
        guard let url else { return false }
        if url.scheme == ShellSchemeHandler.scheme { return true }
        guard isAllowedAddress(url), let host = url.host?.lowercased() else { return false }   // plain http only on the home network
        return HomeStore.shared.homes.contains { $0.hosts.contains(host) } || (openingHome?.hosts.contains(host) ?? false)
    }
    /// A bridge call is answered only for the app's own screens and the exact addresses (scheme, host, port) of your homes.
    func isTrustedOrigin(_ origin: WKSecurityOrigin) -> Bool {
        if origin.protocol == ShellSchemeHandler.scheme { return true }
        let key = Home.originKey(origin.protocol, origin.host, origin.port)
        return HomeStore.shared.homes.contains { $0.originKeys.contains(key) }
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
                decisionHandler(.cancel); Task { await dropSessionCookies() }; tokenCache[h] = nil; Keychain.delete(service: Keychain.tokenService, account: h); openShell("signedout=\(h)"); return
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
    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        // pull to refresh is for your home; the app's own screens retry by themselves
        let want: UIRefreshControl? = onShell ? nil : refresh
        if web.scrollView.refreshControl !== want { web.scrollView.refreshControl = want }
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { reveal() }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        reveal()
        if (error as NSError).code == NSURLErrorCancelled { return }
        if let h = openingHome { openShell("unreachable=\(h.id)") }
        else if !onShell, let id = currentHomeId() { openShell("unreachable=\(id)") }
    }
    /// The page's process stopped (memory pressure, a crash): bring the same page back, never a blank screen.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        if webView.url == nil { start() } else { webView.reload() }
    }
    // confirm() and alert() from the page, as native alerts
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        guard presentedViewController == nil else { completionHandler(false); return }
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        present(a, animated: true)
    }
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        guard presentedViewController == nil else { completionHandler(); return }
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        present(a, animated: true)
    }
    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        guard presentedViewController == nil else { completionHandler(nil); return }
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
