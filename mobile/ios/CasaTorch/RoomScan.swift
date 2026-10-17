import RoomPlan
import UIKit

/// Scanning a room with the LiDAR scanner (Apple RoomPlan): walls, doors, windows and furniture, exported as a USDZ
/// file that goes straight into your CasaTorch's 3D editor - the same as uploading a scan, without the file juggling.
/// It stays between this phone and your own CasaTorch.
@available(iOS 16.0, *)
final class RoomScan: UIViewController, RoomCaptureViewDelegate {
    static var isSupported: Bool { RoomCaptureSession.isSupported }
    struct Result { let name: String; let data: Data }

    private var captureView: RoomCaptureView!
    private var done: ((Result?) -> Void)?
    private var finalResult: CapturedRoom?
    private let doneButton = UIButton(type: .system), cancelButton = UIButton(type: .system), status = UILabel()

    @MainActor static func run(from vc: UIViewController) async throws -> Result? {
        await withCheckedContinuation { cont in
            let s = RoomScan(); s.done = { cont.resume(returning: $0) }
            s.modalPresentationStyle = .fullScreen
            vc.present(s, animated: true)
        }
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        captureView = RoomCaptureView(frame: view.bounds)
        captureView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        captureView.delegate = self
        view.addSubview(captureView)
        status.text = "Move slowly around the room. Point at every wall, then tap Done."
        status.textColor = .white; status.numberOfLines = 0; status.textAlignment = .center; status.font = .systemFont(ofSize: 15, weight: .medium)
        status.backgroundColor = UIColor.black.withAlphaComponent(0.45); status.layer.cornerRadius = 12; status.clipsToBounds = true
        var d = UIButton.Configuration.filled(); d.title = "Done"; d.cornerStyle = .capsule
        doneButton.configuration = d; doneButton.addAction(UIAction { [weak self] _ in self?.stop() }, for: .touchUpInside)
        var c = UIButton.Configuration.gray(); c.title = "Cancel"; c.cornerStyle = .capsule
        cancelButton.configuration = c; cancelButton.addAction(UIAction { [weak self] _ in self?.finish(nil) }, for: .touchUpInside)
        for v in [status, doneButton, cancelButton] as [UIView] { v.translatesAutoresizingMaskIntoConstraints = false; view.addSubview(v) }
        NSLayoutConstraint.activate([
            cancelButton.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 16), cancelButton.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 8),
            doneButton.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -16), doneButton.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 8),
            status.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 20), status.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -20),
            status.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -20), status.heightAnchor.constraint(greaterThanOrEqualToConstant: 44),
        ])
        UIApplication.shared.isIdleTimerDisabled = true
    }
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        captureView.captureSession.run(configuration: RoomCaptureSession.Configuration())
    }
    private func stop() {
        doneButton.isEnabled = false; status.text = "Finishing the room…"
        captureView.captureSession.stop()
    }
    // RoomCaptureViewDelegate
    func captureView(shouldPresent roomDataForProcessing: CapturedRoomData, error: Error?) -> Bool { true }
    func captureView(didPresent processedResult: CapturedRoom, error: Error?) {
        if let error { status.text = "The scan didn't finish: \(error.localizedDescription)"; doneButton.isEnabled = true; return }
        finalResult = processedResult
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("casatorch-room-\(UUID().uuidString).usdz")
        do {
            try processedResult.export(to: url, exportOptions: .parametric)
            let data = try Data(contentsOf: url)
            try? FileManager.default.removeItem(at: url)
            let room = processedResult.walls.isEmpty ? "Room scan" : "Room scan (\(processedResult.walls.count) walls)"
            finish(Result(name: room, data: data))
        } catch { status.text = "Couldn't save the scan: \(error.localizedDescription)"; doneButton.isEnabled = true }
    }
    private func finish(_ r: Result?) {
        UIApplication.shared.isIdleTimerDisabled = false
        if r == nil { captureView?.captureSession.stop() }
        guard let d = done else { return }
        done = nil
        dismiss(animated: true) { d(r) }
    }
}
