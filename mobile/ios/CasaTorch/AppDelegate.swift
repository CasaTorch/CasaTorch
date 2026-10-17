import FirebaseCore
import FirebaseMessaging
import UIKit
import UserNotifications

/// Alerts: Apple wakes the phone through Firebase Cloud Messaging; the message is sealed by your CasaTorch, and the
/// notification extension (NotificationService) opens it on the phone. Without GoogleService-Info.plist in the app
/// (see mobile/README.md) everything else works and alerts say they're not available.
enum Push {
    static let latestKey = "casatorch.fcm"
    static func homeKey(_ id: String) -> String { "casatorch.pushtoken.\(id)" }
    /// Apple and Google change a phone's push address now and then; the home is told quietly when it's opened.
    static func refreshIfNeeded(home id: String, base: URL, token: String) {
        guard let had = UserDefaults.standard.string(forKey: homeKey(id)), let now = UserDefaults.standard.string(forKey: latestKey), now != had else { return }
        var r = URLRequest(url: base.appendingPathComponent("api/app/push")); r.httpMethod = "PUT"; r.timeoutInterval = 8
        r.setValue("application/json", forHTTPHeaderField: "Content-Type"); r.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        r.httpBody = try? JSONSerialization.data(withJSONObject: ["token": now])
        let req = r
        Task.detached { if let (_, resp) = try? await URLSession.shared.data(for: req), (resp as? HTTPURLResponse)?.statusCode == 200 { UserDefaults.standard.set(now, forKey: homeKey(id)) } }
    }
    static var configured: Bool { Bundle.main.path(forResource: "GoogleService-Info", ofType: "plist") != nil }
    @MainActor static func enable() async throws -> String {
        guard configured else { throw Bridge.Failure("Alerts aren't available in this build of the app yet.") }
        let center = UNUserNotificationCenter.current()
        let granted = (try? await center.requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        guard granted else { throw Bridge.Failure("Alerts are off for CasaTorch. Turn them on in Settings › Notifications › CasaTorch.") }
        UIApplication.shared.registerForRemoteNotifications()
        for _ in 0..<20 {   // the push token arrives shortly after registering
            if let t = try? await Messaging.messaging().token(), !t.isEmpty { UserDefaults.standard.set(t, forKey: latestKey); return t }
            try? await Task.sleep(nanoseconds: 500_000_000)
        }
        throw Bridge.Failure("This phone couldn't get an alert address from Apple. Check it's online and try again.")
    }
}

@main
final class AppDelegate: UIResponder, UIApplicationDelegate, UNUserNotificationCenterDelegate, MessagingDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        if Push.configured {
            FirebaseApp.configure()
            Messaging.messaging().delegate = self
            Messaging.messaging().isAutoInitEnabled = true
        }
        UNUserNotificationCenter.current().delegate = self
        return true
    }
    func application(_ application: UIApplication, configurationForConnecting session: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        UISceneConfiguration(name: "Default", sessionRole: session.role)
    }
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        if Push.configured { Messaging.messaging().apnsToken = deviceToken }
    }
    /// A new push address: each home gets it the next time the app opens it.
    func messaging(_ messaging: Messaging, didReceiveRegistrationToken fcmToken: String?) { if let t = fcmToken, !t.isEmpty { UserDefaults.standard.set(t, forKey: Push.latestKey) } }

    // An alert while the app is open: show it as a banner anyway.
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions { [.banner, .list, .sound] }
    // Tapping an alert opens the page it's about, in the right home.
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let info = response.notification.request.content.userInfo
        let path = info["ct_url"] as? String ?? "/#alerts", home = info["ct_home"] as? String
        await MainActor.run { SceneDelegate.main?.openAlert(path: path.hasPrefix("/") ? path : "/#alerts", homeId: home) }
    }
}
