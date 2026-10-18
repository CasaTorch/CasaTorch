import LocalAuthentication
import UIKit
import UniformTypeIdentifiers
import UserNotifications
import WebKit

/// window.CasaNative's other half. Every call is checked: it must come from the main frame of the app's own screens
/// or of a home you signed in to. Answers go back with window.__casaReply(id, ok, data).
final class Bridge: NSObject, WKScriptMessageHandler {
    private weak var controller: MainViewController?
    init(controller: MainViewController) { self.controller = controller }

    static func infoJSON() -> String {
        var lidar = false, mesh = false
        if #available(iOS 16.0, *) { lidar = RoomScan.isSupported; mesh = MeshScan.isSupported }
        let info: [String: Any] = ["platform": UIDevice.current.userInterfaceIdiom == .pad ? "ipados" : "ios", "version": Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "", "device": UIDevice.current.model, "lidar": lidar, "mesh": mesh]
        let d = (try? JSONSerialization.data(withJSONObject: info)) ?? Data("{}".utf8)
        return String(data: d, encoding: .utf8) ?? "{}"
    }

    func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let vc = controller, message.frameInfo.isMainFrame, vc.isTrustedOrigin(message.frameInfo.securityOrigin),
              let s = message.body as? String, let d = s.data(using: .utf8),
              let m = try? JSONSerialization.jsonObject(with: d) as? [String: Any], let id = m["id"] as? Int, let cmd = m["cmd"] as? String else { return }
        let args = m["args"] as? [String: Any] ?? [:]
        let fromShell = message.frameInfo.securityOrigin.protocol == ShellSchemeHandler.scheme
        Task { @MainActor in
            do { let r = try await self.run(cmd, args, fromShell: fromShell, vc: vc, id: id); self.reply(id, true, r) }
            catch { self.reply(id, false, ["message": error.localizedDescription]) }
        }
    }

    struct Failure: LocalizedError { let errorDescription: String?; init(_ s: String) { errorDescription = s } }

    @MainActor private func run(_ cmd: String, _ a: [String: Any], fromShell: Bool, vc: MainViewController, id callId: Int) async throws -> Any? {
        switch cmd {
        case "haptic":
            switch a["kind"] as? String {
            case "success": UINotificationFeedbackGenerator().notificationOccurred(.success)
            case "error": UINotificationFeedbackGenerator().notificationOccurred(.error)
            case "warning": UINotificationFeedbackGenerator().notificationOccurred(.warning)
            case "light": UIImpactFeedbackGenerator(style: .light).impactOccurred()
            case "medium": UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            default: UISelectionFeedbackGenerator().selectionChanged()
            }
            return nil
        case "fullscreen": vc.fullscreen = (a["on"] as? Bool) ?? false; return nil
        case "openExternal":
            if let s = a["url"] as? String, let u = URL(string: s), ["http", "https"].contains(u.scheme ?? "") { _ = await UIApplication.shared.open(u) }
            return nil
        case "share":
            let items: [Any] = [a["text"] as? String, (a["url"] as? String).flatMap(URL.init(string:))].compactMap { $0 }
            let sheet = UIActivityViewController(activityItems: items, applicationActivities: nil)
            sheet.popoverPresentationController?.sourceView = vc.view; sheet.popoverPresentationController?.sourceRect = CGRect(x: vc.view.bounds.midX, y: vc.view.bounds.midY, width: 1, height: 1)
            vc.present(sheet, animated: true); return true
        case "copy":
            UIPasteboard.general.setItems([[UTType.plainText.identifier: (a["text"] as? String) ?? ""]], options: [.expirationDate: Date().addingTimeInterval(120), .localOnly: true])   // a setup key: local only, gone in 2 minutes
            return true
        case "deviceInfo":
            return ["name": UIDevice.current.name, "platform": UIDevice.current.userInterfaceIdiom == .pad ? "ipados" : "ios", "model": Self.model(), "app": Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""]
        case "biometrics":
            let ctx = LAContext(); var err: NSError?
            let ok = ctx.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &err)
            var type = "none"
            switch ctx.biometryType { case .faceID: type = "faceID"; case .touchID: type = "touchID"; default: if #available(iOS 17.0, *), ctx.biometryType == .opticID { type = "opticID" } }
            return ["available": ok, "type": type, "enabled": HomeStore.shared.biometricLock]
        case "setBiometricLock":
            let on = (a["on"] as? Bool) ?? false
            let ctx = LAContext()
            let ok = (try? await ctx.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: on ? "Turn on the Face ID lock" : "Turn off the Face ID lock")) ?? false
            guard ok else { return false }
            let was = HomeStore.shared.biometricLock
            HomeStore.shared.biometricLock = on
            if was != on { HomeStore.shared.reprotect(context: ctx) }
            return true
        case "pushEnable":
            guard let id = HomeStore.shared.currentId ?? vc.currentHomeId() else { throw Failure("Sign in to a home first.") }
            let token = try await Push.enable()
            UserDefaults.standard.set(token, forKey: Push.homeKey(id))
            let key = HomeStore.shared.alertKey(for: id)
            return ["platform": "ios", "token": token, "key": key.base64EncodedString()]
        case "lidar":
            if #available(iOS 16.0, *), RoomScan.isSupported { return ["available": true, "mesh": MeshScan.isSupported] }
            return ["available": false, "why": "Room scanning needs an iPhone Pro or iPad Pro with a LiDAR scanner (iOS 16 or later)."]
        case "scanRoom":
            guard #available(iOS 16.0, *), RoomScan.isSupported else { throw Failure("This iPhone or iPad has no LiDAR scanner.") }
            guard let r = try await RoomScan.run(from: vc) else { return nil }
            await sendChunks(r.data, callId: callId, vc: vc)
            return ["name": r.name, "size": r.data.count, "chunked": true]
        case "scanMesh":
            // a photo-real scan: the LiDAR mesh colored from the camera (MeshScan.swift), as a PLY file
            guard #available(iOS 16.0, *), MeshScan.isSupported else { throw Failure("Photo-real scans need an iPhone Pro or iPad Pro with a LiDAR scanner (iOS 16 or later).") }
            guard let r = await MeshScan.run(from: vc) else { return nil }
            await sendChunks(r.data, callId: callId, vc: vc)
            return ["name": r.name, "size": r.data.count, "chunked": true]
        case "probe":
            // the app's own screens asking "is there a CasaTorch at this address?" - see Probe in Net.swift
            guard fromShell, let s = a["url"] as? String, let u = URL(string: s), ["http", "https"].contains(u.scheme ?? ""), u.host != nil else { throw Failure("Not allowed here.") }
            let ms = (a["timeout"] as? Double) ?? 5000
            return await Probe.run(u, timeout: min(max(ms, 1000), 15000) / 1000)
        case "discover":
            // the app's own Find screen: CasaTorch boxes announcing themselves on this Wi-Fi - see Discover in Net.swift
            guard fromShell else { throw Failure("Not allowed here.") }
            let ms = (a["timeout"] as? Double) ?? 3000
            return await Discover.run(timeout: min(max(ms, 1000), 8000) / 1000)
        case "scanQR":
            return try await QRScanner.scan(from: vc)
        case "homes":
            return HomeStore.shared.homes.map { h -> [String: Any] in
                var o: [String: Any] = ["id": h.id, "name": h.name, "user": ["name": h.user?.name ?? "", "role": h.user?.role ?? ""], "addresses": ["lan": h.addresses.lan.map { $0 as Any } ?? NSNull(), "remote": h.addresses.remote.map { $0 as Any } ?? NSNull(), "plain": h.addresses.plain.map { $0 as Any } ?? NSNull(), "here": h.addresses.here.map { $0 as Any } ?? NSNull()]]
                if let l = h.last { o["last"] = ISO8601DateFormatter().string(from: l) }
                return o
            }
        case "saveHome":
            guard fromShell else { throw Failure("Not allowed here.") }
            guard let id = a["id"] as? String, let name = a["name"] as? String, let token = a["token"] as? String, id.range(of: "^[A-Za-z0-9_-]{8,40}$", options: .regularExpression) != nil else { throw Failure("That sign-in didn't come back right.") }
            let ad = a["addresses"] as? [String: Any] ?? [:], u = a["user"] as? [String: Any] ?? [:]
            let clean: (Any?) -> String? = { v in guard let s = v as? String, let url = URL(string: s), isAllowedAddress(url) else { return nil }; return s }
            let home = Home(id: id, name: String(name.prefix(60)), user: .init(name: u["name"] as? String, role: u["role"] as? String),
                            addresses: .init(lan: clean(ad["lan"]), remote: clean(ad["remote"]), plain: clean(ad["plain"]), here: clean(ad["here"])), last: Date())
            guard HomeStore.shared.upsert(home, token: token) else { throw Failure("This phone's secure storage didn't take the sign-in.") }
            return true
        case "openHome":
            if let id = a["id"] as? String { vc.openHome(id) }
            return nil
        case "removeHome":
            guard fromShell, let id = a["id"] as? String else { throw Failure("Not allowed here.") }
            HomeStore.shared.remove(id); vc.tokenCache[id] = nil; return true
        case "switchHome": vc.openShell("homes"); return nil
        case "signOut":
            if let id = vc.currentHomeId() { HomeStore.shared.remove(id); vc.tokenCache[id] = nil }
            await vc.dropSessionCookies()
            HomeStore.shared.homes.isEmpty ? vc.openShell("welcome") : vc.openShell("homes")
            return nil
        default: throw Failure("The app doesn't know \"\(cmd)\" - update it from the App Store.")
        }
    }

    /// A scan file goes to the page in pieces (the bridge joins them).
    @MainActor private func sendChunks(_ data: Data, callId: Int, vc: MainViewController) async {
        let chunk = 512 * 1024
        var off = 0
        while off < data.count {
            let piece = data.subdata(in: off..<min(off + chunk, data.count)).base64EncodedString()
            _ = try? await vc.web.evaluateJavaScript("window.__casaChunk(\(callId), '\(piece)'); 1")
            off += chunk
        }
    }

    @MainActor private func reply(_ id: Int, _ ok: Bool, _ data: Any?) {
        let payload: String
        if let data, JSONSerialization.isValidJSONObject(data), let d = try? JSONSerialization.data(withJSONObject: data), let s = String(data: d, encoding: .utf8) { payload = s }
        else if let b = data as? Bool { payload = b ? "true" : "false" }
        else if let s = data as? String, let d = try? JSONSerialization.data(withJSONObject: [s]), let arr = String(data: d, encoding: .utf8) { payload = String(arr.dropFirst().dropLast()) }
        else { payload = "null" }
        controller?.web.evaluateJavaScript("window.__casaReply && window.__casaReply(\(id), \(ok), \(payload)); 1", completionHandler: nil)
    }
    static func model() -> String {
        var s = utsname(); uname(&s)
        return withUnsafeBytes(of: &s.machine) { String(decoding: $0.prefix { $0 != 0 }, as: UTF8.self) }
    }
}
