import LocalAuthentication
import UIKit

/// Face ID / Touch ID lock: covers the app when it opens and after a couple of minutes away, and the sign-in itself
/// stays in the Keychain behind Face ID - so even a phone left unlocked on the counter doesn't open your front door
/// camera to anyone. The passcode is the fallback, as everywhere on iOS.
final class LockOverlay: UIView {
    weak var controller: MainViewController?
    private let button = UIButton(type: .system)
    private var busy = false
    static var biometryName: String {
        let c = LAContext(); _ = c.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
        switch c.biometryType { case .faceID: return "Face ID"; case .touchID: return "Touch ID"; default:
            if #available(iOS 17.0, *), c.biometryType == .opticID { return "Optic ID" }
            return "Passcode" }
    }

    init(controller: MainViewController) {
        self.controller = controller
        super.init(frame: controller.view.bounds)
        autoresizingMask = [.flexibleWidth, .flexibleHeight]
        let blur = UIVisualEffectView(effect: UIBlurEffect(style: .systemThickMaterialDark))
        blur.frame = bounds; blur.autoresizingMask = [.flexibleWidth, .flexibleHeight]; addSubview(blur)
        let logo = UIImageView(image: UIImage(named: "LaunchLogo")); logo.contentMode = .scaleAspectFit
        let title = UILabel(); title.text = "CasaTorch is locked"; title.font = .systemFont(ofSize: 22, weight: .semibold); title.textColor = .white
        var cfg = UIButton.Configuration.filled(); cfg.cornerStyle = .large; cfg.baseBackgroundColor = UIColor(red: 0.37, green: 0.72, blue: 1, alpha: 1); cfg.baseForegroundColor = UIColor(red: 0.02, green: 0.07, blue: 0.11, alpha: 1)
        cfg.title = "Unlock with \(Self.biometryName)"; cfg.contentInsets = NSDirectionalEdgeInsets(top: 14, leading: 28, bottom: 14, trailing: 28)
        button.configuration = cfg; button.addTarget(self, action: #selector(unlock), for: .touchUpInside)
        let stack = UIStackView(arrangedSubviews: [logo, title, button]); stack.axis = .vertical; stack.alignment = .center; stack.spacing = 22
        stack.translatesAutoresizingMaskIntoConstraints = false; addSubview(stack)
        NSLayoutConstraint.activate([stack.centerXAnchor.constraint(equalTo: centerXAnchor), stack.centerYAnchor.constraint(equalTo: centerYAnchor), logo.widthAnchor.constraint(equalToConstant: 84), logo.heightAnchor.constraint(equalToConstant: 84)])
        isHidden = true
    }
    required init?(coder: NSCoder) { fatalError() }

    var isLocked: Bool { !isHidden }
    func show() { guard HomeStore.shared.biometricLock, let c = controller else { return }; c.view.bringSubviewToFront(self); isHidden = false; Task { await c.dropSessionCookies() } }
    /// Ask now (on open and coming back), then open the home with the same unlocked context: one prompt, not two.
    @objc func unlock() {
        guard !busy else { return }
        busy = true
        let ctx = LAContext(); ctx.localizedFallbackTitle = "Use Passcode"
        ctx.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: "Unlock CasaTorch") { ok, _ in
            DispatchQueue.main.async {
                self.busy = false
                guard ok, let c = self.controller else { return }
                UIView.animate(withDuration: 0.25, animations: { self.alpha = 0 }) { _ in self.isHidden = true; self.alpha = 1 }
                c.resume(context: ctx)
            }
        }
    }
}
