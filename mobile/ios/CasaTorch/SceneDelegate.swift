import UIKit

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    static weak var main: MainViewController?
    private var backgroundedAt: Date?
    /// After this long away, the Face ID lock asks again.
    private let relockAfter: TimeInterval = 120

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options: UIScene.ConnectionOptions) {
        guard let ws = scene as? UIWindowScene else { return }
        let vc = MainViewController()
        let w = UIWindow(windowScene: ws); w.rootViewController = vc; w.makeKeyAndVisible(); window = w
        SceneDelegate.main = vc
        _ = vc.view   // loads the web view
        let lock = LockOverlay(controller: vc); vc.view.addSubview(lock); vc.lock = lock
        if HomeStore.shared.biometricLock, HomeStore.shared.current != nil { lock.show(); lock.unlock() }
        if let u = options.urlContexts.first?.url { DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { vc.handlePairLink(u) } }
    }
    func scene(_ scene: UIScene, openURLContexts contexts: Set<UIOpenURLContext>) {
        if let u = contexts.first?.url { SceneDelegate.main?.handlePairLink(u) }
    }
    func sceneDidEnterBackground(_ scene: UIScene) {
        backgroundedAt = Date()
        // what's on screen is hidden from the app switcher while locked
        if HomeStore.shared.biometricLock { SceneDelegate.main?.lock?.show() }
    }
    func sceneWillEnterForeground(_ scene: UIScene) {
        guard let vc = SceneDelegate.main, let lock = vc.lock, HomeStore.shared.biometricLock, lock.isLocked else { return }
        if let at = backgroundedAt, Date().timeIntervalSince(at) < relockAfter {
            // back within two minutes: no prompt, the sign-in comes back quietly (it's still in memory in the web view's page)
            lock.isHidden = true
            if let id = vc.currentHomeId() { vc.openHomeQuietly(id) }
        } else { vc.tokenCache.removeAll(); lock.unlock() }
    }
}
