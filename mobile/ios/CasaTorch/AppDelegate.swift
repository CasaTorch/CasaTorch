import UIKit
import UserNotifications

/// Alerts: Apple wakes the phone straight from casatorch.com's relay (APNs - no Firebase on iPhone and iPad); the
/// message is sealed by your CasaTorch, and the notification extension (NotificationService) opens it on the phone.
enum Push {
    static let latestKey = "casatorch.apns"
    static func homeKey(_ id: String) -> String { "casatorch.pushtoken.\(id)" }
    /// This phone's APNs device token (hex), from didRegisterForRemoteNotificationsWithDeviceToken.
    /// (Both are set and read on the main thread only: Apple calls the app delegate there, and enable() is @MainActor.)
    static var deviceToken: String? = UserDefaults.standard.string(forKey: latestKey)
    static var registerError: Error?

    /// Which Apple server this build's token belongs to: "sandbox" for a build run from Xcode (its provisioning profile
    /// says aps-environment development), "production" for TestFlight and the App Store (which carry no profile) and
    /// ad-hoc builds. casatorch.com tries the other one by itself if this is ever wrong.
    static let environment: String = {
        #if targetEnvironment(simulator)
        return "sandbox"
        #else
        guard let url = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision"),
              let data = try? Data(contentsOf: url),
              let text = String(data: data, encoding: .isoLatin1),
              let start = text.range(of: "<?xml"),
              let end = text.range(of: "</plist>", range: start.upperBound..<text.endIndex),
              let xml = String(text[start.lowerBound..<end.upperBound]).data(using: .isoLatin1),
              let plist = (try? PropertyListSerialization.propertyList(from: xml, options: [], format: nil)) as? [String: Any],
              let ent = plist["Entitlements"] as? [String: Any],
              let aps = ent["aps-environment"] as? String
        else { return "production" }
        return aps == "development" ? "sandbox" : "production"
        #endif
    }()

    /// Apple changes a phone's push address now and then; the home is told quietly when it's opened.
    static func refreshIfNeeded(home id: String, base: URL, token: String) {
        guard let had = UserDefaults.standard.string(forKey: homeKey(id)), let now = UserDefaults.standard.string(forKey: latestKey), now != had else { return }
        var r = URLRequest(url: base.appendingPathComponent("api/app/push")); r.httpMethod = "PUT"; r.timeoutInterval = 8
        r.setValue("application/json", forHTTPHeaderField: "Content-Type"); r.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        r.httpBody = try? JSONSerialization.data(withJSONObject: ["token": now, "platform": "apns", "env": environment])
        let req = r
        let key = homeKey(id)
        Task.detached {
            guard let res = try? await URLSession.shared.data(for: req), (res.1 as? HTTPURLResponse)?.statusCode == 200 else { return }
            UserDefaults.standard.set(now, forKey: key)
        }
    }

    /// Asks once for permission, registers with Apple and waits for this phone's device token.
    @MainActor static func enable() async throws -> String {
        let center = UNUserNotificationCenter.current()
        let granted = (try? await center.requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        guard granted else { throw Bridge.Failure("Alerts are off for CasaTorch. Turn them on in Settings › Notifications › CasaTorch.") }
        registerError = nil
        UIApplication.shared.registerForRemoteNotifications()
        for _ in 0..<40 {   // Apple answers within a second or two
            if let e = registerError {
                // 3000: the build has no push entitlement (aps-environment) - truly not available in this app
                if (e as NSError).domain == NSCocoaErrorDomain && (e as NSError).code == 3000 { throw Bridge.Failure("Phone alerts aren't switched on for this CasaTorch app yet.") }
                throw Bridge.Failure("This phone couldn't get an alert address from Apple. Check it's online and try again.")
            }
            if let t = deviceToken, !t.isEmpty { return t }
            try? await Task.sleep(nanoseconds: 250_000_000)
        }
        throw Bridge.Failure("This phone couldn't get an alert address from Apple. Check it's online and try again.")
    }
}

@main
final class AppDelegate: UIResponder, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        // Alerts already allowed: register at every launch, as Apple asks, so a changed device token is picked up
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            let status = settings.authorizationStatus
            guard status == .authorized || status == .provisional || status == .ephemeral else { return }
            DispatchQueue.main.async { UIApplication.shared.registerForRemoteNotifications() }
        }
        Self.keepOutOfBackups()
        return true
    }
    /// What the web view keeps on disk (its cache and page storage) stays on this phone: not in iCloud or computer
    /// backups. Sign-ins are in the Keychain, "this device only", so they never travel either.
    static func keepOutOfBackups() {
        guard let lib = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask).first else { return }
        for name in ["WebKit", "Cookies", "Caches"] {
            var dir = lib.appendingPathComponent(name, isDirectory: true)
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
            var v = URLResourceValues(); v.isExcludedFromBackup = true
            try? dir.setResourceValues(v)
        }
    }
    func application(_ application: UIApplication, configurationForConnecting session: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        UISceneConfiguration(name: "Default", sessionRole: session.role)
    }
    /// This phone's push address from Apple (each home gets a new one the next time the app opens it).
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
        Push.deviceToken = hex
        Push.registerError = nil
        UserDefaults.standard.set(hex, forKey: Push.latestKey)
    }
    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        Push.registerError = error
    }

    // An alert while the app is open: show it as a banner anyway.
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions { [.banner, .list, .sound] }
    // Tapping an alert opens the page it's about, in the right home.
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let info = response.notification.request.content.userInfo
        let path = info["ct_url"] as? String ?? "/#alerts", home = info["ct_home"] as? String
        await MainActor.run { SceneDelegate.main?.openAlert(path: path.hasPrefix("/") ? path : "/#alerts", homeId: home) }
    }
}
