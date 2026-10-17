import AVFoundation
import UIKit

/// Scans the pairing QR code your CasaTorch shows (Settings › Phones & alerts › Add a phone).
final class QRScanner: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    private let session = AVCaptureSession()
    private var done: ((String?) -> Void)?
    private var failed = false   // the camera wouldn't start: closes as soon as the screen is up (dismissing mid-presentation is ignored)

    @MainActor static func scan(from vc: UIViewController) async throws -> String? {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .denied, .restricted: throw Bridge.Failure("CasaTorch isn't allowed to use the camera. Turn it on in Settings › CasaTorch, or type the code instead.")
        case .notDetermined: if !(await AVCaptureDevice.requestAccess(for: .video)) { throw Bridge.Failure("Without the camera, type the pairing code instead.") }
        default: break
        }
        guard AVCaptureDevice.default(for: .video) != nil else { throw Bridge.Failure("This device has no camera to scan with - type the pairing code instead.") }
        return await withCheckedContinuation { cont in
            let s = QRScanner(); s.done = { cont.resume(returning: $0) }
            s.modalPresentationStyle = .fullScreen
            vc.present(s, animated: true)
        }
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        guard let cam = AVCaptureDevice.default(for: .video), let input = try? AVCaptureDeviceInput(device: cam), session.canAddInput(input) else { failed = true; return }
        session.addInput(input)
        let out = AVCaptureMetadataOutput()
        guard session.canAddOutput(out) else { failed = true; return }
        session.addOutput(out)
        out.setMetadataObjectsDelegate(self, queue: .main)
        out.metadataObjectTypes = [.qr]
        let layer = AVCaptureVideoPreviewLayer(session: session)
        layer.videoGravity = .resizeAspectFill; layer.frame = view.bounds
        view.layer.addSublayer(layer)
        // a frame to aim with, and a way out
        let frame = UIView(); frame.layer.borderColor = UIColor.white.withAlphaComponent(0.9).cgColor; frame.layer.borderWidth = 3; frame.layer.cornerRadius = 24
        frame.translatesAutoresizingMaskIntoConstraints = false; view.addSubview(frame)
        let hint = UILabel(); hint.text = "Point at the code on your CasaTorch"; hint.textColor = .white; hint.font = .systemFont(ofSize: 17, weight: .semibold); hint.translatesAutoresizingMaskIntoConstraints = false; view.addSubview(hint)
        var cfg = UIButton.Configuration.gray(); cfg.title = "Cancel"; cfg.cornerStyle = .capsule
        let cancel = UIButton(configuration: cfg, primaryAction: UIAction { [weak self] _ in self?.finish(nil) }); cancel.translatesAutoresizingMaskIntoConstraints = false; view.addSubview(cancel)
        NSLayoutConstraint.activate([
            frame.centerXAnchor.constraint(equalTo: view.centerXAnchor), frame.centerYAnchor.constraint(equalTo: view.centerYAnchor), frame.widthAnchor.constraint(equalToConstant: 250), frame.heightAnchor.constraint(equalToConstant: 250),
            hint.centerXAnchor.constraint(equalTo: view.centerXAnchor), hint.bottomAnchor.constraint(equalTo: frame.topAnchor, constant: -24),
            cancel.centerXAnchor.constraint(equalTo: view.centerXAnchor), cancel.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -24),
        ])
        DispatchQueue.global(qos: .userInitiated).async { [session] in session.startRunning() }
    }
    override func viewDidAppear(_ animated: Bool) { super.viewDidAppear(animated); if failed { finish(nil) } }
    func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput objects: [AVMetadataObject], from connection: AVCaptureConnection) {
        guard let s = (objects.first as? AVMetadataMachineReadableCodeObject)?.stringValue else { return }
        if s.hasPrefix("casatorch://pair") { UINotificationFeedbackGenerator().notificationOccurred(.success); finish(s) }
    }
    private func finish(_ value: String?) {
        guard let d = done else { return }
        done = nil
        DispatchQueue.global(qos: .userInitiated).async { [session] in session.stopRunning() }
        dismiss(animated: true) { d(value) }
    }
}
