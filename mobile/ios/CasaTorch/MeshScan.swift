import ARKit
import RealityKit
import UIKit

/// A photo-real scan: the LiDAR scanner's own 3D mesh of the room (ARKit scene reconstruction), colored from the
/// camera - the real walls, floor and furniture as they look - saved as a PLY file (points, their colors, triangles)
/// that goes straight into your CasaTorch's 3D editor as a "photo-real scan" on a floor. RoomScan (Apple RoomPlan) is
/// the other kind: clean boxes for walls and furniture, no photos.
///
/// How the colors are made: while you walk, a small photo (320 x 240) and the LiDAR depth are kept every time the phone
/// has moved or turned enough (up to 80). When you tap Done, each point of the mesh takes its color from the photo
/// that saw it best - facing it, from close by, and not hidden behind something else (the depth says so).
/// Nothing leaves the phone except the finished file, sent to your own CasaTorch.
@available(iOS 16.0, *)
final class MeshScan: UIViewController, ARSessionDelegate {
    static var isSupported: Bool { ARWorldTrackingConfiguration.supportsSceneReconstruction(.meshWithClassification) }
    struct Result { let name: String; let data: Data }

    /// One kept photo: the picture (RGB bytes), the depth (meters, may be missing), and where the camera was.
    fileprivate struct Keyframe: Sendable {
        let rgb: [UInt8]; let width: Int; let height: Int
        let depth: [Float]; let depthWidth: Int; let depthHeight: Int
        let view: simd_float4x4        // world -> camera
        let position: simd_float3
        let forward: simd_float3
        let fx: Float, fy: Float, cx: Float, cy: Float   // for the full camera image
        let imageWidth: Float, imageHeight: Float
    }

    private var arView: ARView!
    private var done: ((Result?) -> Void)?
    private var keyframes: [Keyframe] = []
    private var lastKeyTime: TimeInterval = 0
    private var finishing = false
    private let maxKeyframes = 80, photoWidth = 320, photoHeight = 240
    private let doneButton = UIButton(type: .system), cancelButton = UIButton(type: .system)
    private let status = UILabel(), counter = UILabel()

    @MainActor static func run(from vc: UIViewController) async -> Result? {
        await withCheckedContinuation { cont in
            let s = MeshScan(); s.done = { cont.resume(returning: $0) }
            s.modalPresentationStyle = .fullScreen
            vc.present(s, animated: true)
        }
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        arView = ARView(frame: view.bounds, cameraMode: .ar, automaticallyConfigureSession: false)
        arView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        arView.debugOptions.insert(.showSceneUnderstanding)   // the mesh appears over the camera as it is scanned
        arView.renderOptions.insert(.disableMotionBlur)
        view.addSubview(arView)
        arView.session.delegate = self

        status.text = "Move slowly. Point at every wall, the floor and the corners - the mesh fills in as you go. Tap Done when the room is covered."
        counter.text = "Photos for color: 0"
        for l in [status, counter] {
            l.textColor = .white; l.numberOfLines = 0; l.textAlignment = .center
            l.backgroundColor = UIColor.black.withAlphaComponent(0.5); l.layer.cornerRadius = 12; l.clipsToBounds = true
        }
        status.font = .preferredFont(forTextStyle: .callout); status.adjustsFontForContentSizeCategory = true
        counter.font = .preferredFont(forTextStyle: .footnote); counter.adjustsFontForContentSizeCategory = true
        var d = UIButton.Configuration.filled(); d.title = "Done"; d.cornerStyle = .capsule
        doneButton.configuration = d; doneButton.addAction(UIAction { [weak self] _ in self?.stop() }, for: .touchUpInside)
        var c = UIButton.Configuration.gray(); c.title = "Cancel"; c.cornerStyle = .capsule
        cancelButton.configuration = c; cancelButton.addAction(UIAction { [weak self] _ in self?.finish(nil) }, for: .touchUpInside)
        for v in [status, counter, doneButton, cancelButton] as [UIView] { v.translatesAutoresizingMaskIntoConstraints = false; view.addSubview(v) }
        let g = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            cancelButton.leadingAnchor.constraint(equalTo: g.leadingAnchor, constant: 16), cancelButton.topAnchor.constraint(equalTo: g.topAnchor, constant: 8),
            doneButton.trailingAnchor.constraint(equalTo: g.trailingAnchor, constant: -16), doneButton.topAnchor.constraint(equalTo: g.topAnchor, constant: 8),
            counter.centerXAnchor.constraint(equalTo: g.centerXAnchor), counter.centerYAnchor.constraint(equalTo: doneButton.centerYAnchor),
            counter.leadingAnchor.constraint(greaterThanOrEqualTo: cancelButton.trailingAnchor, constant: 8), counter.trailingAnchor.constraint(lessThanOrEqualTo: doneButton.leadingAnchor, constant: -8),
            counter.heightAnchor.constraint(greaterThanOrEqualToConstant: 32),
            status.leadingAnchor.constraint(equalTo: g.leadingAnchor, constant: 20), status.trailingAnchor.constraint(equalTo: g.trailingAnchor, constant: -20),
            status.bottomAnchor.constraint(equalTo: g.bottomAnchor, constant: -20), status.heightAnchor.constraint(greaterThanOrEqualToConstant: 44),
        ])
        UIApplication.shared.isIdleTimerDisabled = true
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        let config = ARWorldTrackingConfiguration()
        config.sceneReconstruction = .meshWithClassification
        if ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth) { config.frameSemantics.insert(.sceneDepth) }
        config.environmentTexturing = .none
        arView.session.run(config)
    }

    // MARK: ARSessionDelegate

    func session(_ session: ARSession, cameraDidChangeTrackingState camera: ARCamera) {
        guard !finishing else { return }
        switch camera.trackingState {
        case .limited(.excessiveMotion): status.text = "Slow down a little - move the phone slowly and smoothly."
        case .limited(.insufficientFeatures): status.text = "Point at something with more detail, or turn on more lights."
        case .limited(.initializing), .limited(.relocalizing): status.text = "Getting ready… move the phone slowly from side to side."
        case .notAvailable: status.text = "The camera isn't tracking. Hold the phone up and move slowly."
        default: status.text = "Move slowly. Point at every wall, the floor and the corners - the mesh fills in as you go. Tap Done when the room is covered."
        }
    }

    func session(_ session: ARSession, didUpdate frame: ARFrame) {
        guard !finishing, keyframes.count < maxKeyframes, case .normal = frame.camera.trackingState else { return }
        guard frame.timestamp - lastKeyTime > 0.35 else { return }
        let t = frame.camera.transform
        let pos = simd_float3(t.columns.3.x, t.columns.3.y, t.columns.3.z)
        let fwd = -simd_normalize(simd_float3(t.columns.2.x, t.columns.2.y, t.columns.2.z))
        if let last = keyframes.last {
            let moved = simd_distance(pos, last.position) > 0.3
            let turned = simd_dot(fwd, last.forward) < cos(Float.pi / 12)   // 15°
            guard moved || turned else { return }
        }
        // Copy what's needed now: ARKit's frames must not be kept (it would run out of them).
        guard let kf = Self.keyframe(from: frame, width: photoWidth, height: photoHeight) else { return }
        lastKeyTime = frame.timestamp
        keyframes.append(kf)
        counter.text = keyframes.count >= maxKeyframes ? "Photos for color: \(keyframes.count) (enough - keep scanning the shape if you like)" : "Photos for color: \(keyframes.count)"
    }

    private static func keyframe(from frame: ARFrame, width: Int, height: Int) -> Keyframe? {
        let img = frame.capturedImage
        guard CVPixelBufferGetPlaneCount(img) >= 2 else { return nil }
        CVPixelBufferLockBaseAddress(img, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(img, .readOnly) }
        guard let yBase = CVPixelBufferGetBaseAddressOfPlane(img, 0), let cBase = CVPixelBufferGetBaseAddressOfPlane(img, 1) else { return nil }
        let w = CVPixelBufferGetWidthOfPlane(img, 0), h = CVPixelBufferGetHeightOfPlane(img, 0)
        let yRow = CVPixelBufferGetBytesPerRowOfPlane(img, 0), cRow = CVPixelBufferGetBytesPerRowOfPlane(img, 1)
        let fullRange = CVPixelBufferGetPixelFormatType(img) == kCVPixelFormatType_420YpCbCr8BiPlanarFullRange
        let yp = yBase.assumingMemoryBound(to: UInt8.self), cp = cBase.assumingMemoryBound(to: UInt8.self)
        var rgb = [UInt8](repeating: 0, count: width * height * 3)
        for oy in 0..<height {
            let sy = min(h - 1, oy * h / height)
            for ox in 0..<width {
                let sx = min(w - 1, ox * w / width)
                var Y = Float(yp[sy * yRow + sx])
                var cb = Float(cp[(sy / 2) * cRow + (sx / 2) * 2]) - 128, cr = Float(cp[(sy / 2) * cRow + (sx / 2) * 2 + 1]) - 128
                if !fullRange { Y = (Y - 16) * 1.164; cb *= 1.138; cr *= 1.138 }
                let r = Y + 1.402 * cr, g = Y - 0.344136 * cb - 0.714136 * cr, b = Y + 1.772 * cb
                let o = (oy * width + ox) * 3
                rgb[o] = UInt8(max(0, min(255, r))); rgb[o + 1] = UInt8(max(0, min(255, g))); rgb[o + 2] = UInt8(max(0, min(255, b)))
            }
        }
        var depth: [Float] = [], dw = 0, dh = 0
        if let dm = frame.sceneDepth?.depthMap, CVPixelBufferGetPixelFormatType(dm) == kCVPixelFormatType_DepthFloat32 {
            CVPixelBufferLockBaseAddress(dm, .readOnly)
            if let base = CVPixelBufferGetBaseAddress(dm) {
                dw = CVPixelBufferGetWidth(dm); dh = CVPixelBufferGetHeight(dm)
                let row = CVPixelBufferGetBytesPerRow(dm)
                depth = [Float](repeating: 0, count: dw * dh)
                for y in 0..<dh {
                    let line = base.advanced(by: y * row).assumingMemoryBound(to: Float32.self)
                    for x in 0..<dw { depth[y * dw + x] = line[x] }
                }
            }
            CVPixelBufferUnlockBaseAddress(dm, .readOnly)
        }
        let cam = frame.camera, K = cam.intrinsics, t = cam.transform
        return Keyframe(rgb: rgb, width: width, height: height, depth: depth, depthWidth: dw, depthHeight: dh,
                        view: t.inverse, position: simd_float3(t.columns.3.x, t.columns.3.y, t.columns.3.z),
                        forward: -simd_normalize(simd_float3(t.columns.2.x, t.columns.2.y, t.columns.2.z)),
                        fx: K.columns.0.x, fy: K.columns.1.y, cx: K.columns.2.x, cy: K.columns.2.y,
                        imageWidth: Float(cam.imageResolution.width), imageHeight: Float(cam.imageResolution.height))
    }

    // MARK: finishing

    /// The mesh as plain arrays (world coordinates, meters, Y up), copied out of ARKit's buffers.
    fileprivate struct Mesh: Sendable { var points: [simd_float3] = []; var normals: [simd_float3] = []; var faces: [UInt32] = [] }

    private static func mesh(from anchors: [ARMeshAnchor]) -> Mesh {
        var m = Mesh()
        for a in anchors {
            let g = a.geometry, t = a.transform, base = UInt32(m.points.count)
            let rot = simd_float3x3(simd_float3(t.columns.0.x, t.columns.0.y, t.columns.0.z), simd_float3(t.columns.1.x, t.columns.1.y, t.columns.1.z), simd_float3(t.columns.2.x, t.columns.2.y, t.columns.2.z))
            let vs = g.vertices, ns = g.normals
            for i in 0..<vs.count {
                let p = vs.buffer.contents().advanced(by: vs.offset + vs.stride * i).assumingMemoryBound(to: (Float, Float, Float).self).pointee
                let w = t * simd_float4(p.0, p.1, p.2, 1)
                m.points.append(simd_float3(w.x, w.y, w.z))
                if i < ns.count {
                    let n = ns.buffer.contents().advanced(by: ns.offset + ns.stride * i).assumingMemoryBound(to: (Float, Float, Float).self).pointee
                    m.normals.append(simd_normalize(rot * simd_float3(n.0, n.1, n.2)))
                } else { m.normals.append(simd_float3(0, 1, 0)) }
            }
            let f = g.faces, per = f.indexCountPerPrimitive
            guard per == 3 else { continue }
            let raw = f.buffer.contents()
            for i in 0..<(f.count * 3) {
                let idx: UInt32 = f.bytesPerIndex == 4 ? raw.advanced(by: i * 4).assumingMemoryBound(to: UInt32.self).pointee : UInt32(raw.advanced(by: i * 2).assumingMemoryBound(to: UInt16.self).pointee)
                m.faces.append(base + idx)
            }
        }
        return m
    }

    /// Each point's color from the photo that saw it best (facing it, close, in the middle of the picture, not hidden).
    nonisolated private static func colors(for m: Mesh, from kfs: [Keyframe]) -> [UInt8] {
        var out = [UInt8](repeating: 180, count: m.points.count * 3)
        for i in 0..<m.points.count {
            let p = m.points[i], n = m.normals[i]
            var best: Float = 0, color: (UInt8, UInt8, UInt8)? = nil
            for k in kfs {
                let c = k.view * simd_float4(p, 1)
                let d = -c.z
                guard d > 0.15, d < 8 else { continue }
                let u = k.fx * (c.x / d) + k.cx, v = k.fy * (-c.y / d) + k.cy   // pixels in the full camera image
                guard u >= 2, v >= 2, u < k.imageWidth - 2, v < k.imageHeight - 2 else { continue }
                let toCam = simd_normalize(k.position - p), facing = simd_dot(n, toCam)
                guard facing > 0.15 else { continue }
                if !k.depth.isEmpty {
                    let dx = min(k.depthWidth - 1, Int(u / k.imageWidth * Float(k.depthWidth))), dy = min(k.depthHeight - 1, Int(v / k.imageHeight * Float(k.depthHeight)))
                    let seen = k.depth[dy * k.depthWidth + dx]
                    if seen > 0, abs(seen - d) > 0.08 + 0.03 * d { continue }   // something else is in front of it in this photo
                }
                let du = (u / k.imageWidth - 0.5) * 2, dv = (v / k.imageHeight - 0.5) * 2
                let score = facing / max(0.25, d * d) * (1.2 - 0.5 * min(1, du * du + dv * dv))
                guard score > best else { continue }
                best = score
                let px = min(k.width - 1, Int(u / k.imageWidth * Float(k.width))), py = min(k.height - 1, Int(v / k.imageHeight * Float(k.height)))
                let o = (py * k.width + px) * 3
                color = (k.rgb[o], k.rgb[o + 1], k.rgb[o + 2])
            }
            if let c = color { out[i * 3] = c.0; out[i * 3 + 1] = c.1; out[i * 3 + 2] = c.2 }
        }
        return out
    }

    /// Binary PLY: x y z, nx ny nz (float), red green blue (byte); triangles as 3 indices.
    nonisolated private static func ply(_ m: Mesh, _ rgb: [UInt8]) -> Data {
        var d = Data()
        let header = "ply\nformat binary_little_endian 1.0\ncomment CasaTorch photo-real scan (meters, Y up)\nelement vertex \(m.points.count)\nproperty float x\nproperty float y\nproperty float z\nproperty float nx\nproperty float ny\nproperty float nz\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nelement face \(m.faces.count / 3)\nproperty list uchar uint vertex_indices\nend_header\n"
        d.append(Data(header.utf8))
        d.reserveCapacity(header.utf8.count + m.points.count * 27 + m.faces.count / 3 * 13)
        func putF(_ f: Float) { var v = f.bitPattern.littleEndian; withUnsafeBytes(of: &v) { d.append(contentsOf: $0) } }
        func putU(_ u: UInt32) { var v = u.littleEndian; withUnsafeBytes(of: &v) { d.append(contentsOf: $0) } }
        for i in 0..<m.points.count {
            let p = m.points[i], n = m.normals[i]
            putF(p.x); putF(p.y); putF(p.z); putF(n.x); putF(n.y); putF(n.z)
            d.append(contentsOf: [rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]])
        }
        var i = 0
        while i + 2 < m.faces.count { d.append(UInt8(3)); putU(m.faces[i]); putU(m.faces[i + 1]); putU(m.faces[i + 2]); i += 3 }
        return d
    }

    private func stop() {
        guard !finishing else { return }
        let anchors = (arView.session.currentFrame?.anchors ?? []).compactMap { $0 as? ARMeshAnchor }
        guard !anchors.isEmpty else { status.text = "Nothing scanned yet. Point the phone at the walls and move slowly."; return }
        finishing = true
        doneButton.isEnabled = false; cancelButton.isEnabled = false
        status.text = "Coloring the scan… this takes a few seconds."
        let m = MeshScan.mesh(from: anchors)   // copied out of ARKit's buffers before the session stops
        arView.session.pause()
        let kfs = keyframes
        keyframes = []
        // The heavy coloring runs off the main thread; the result comes back here (no shared mutable state crosses).
        Task { @MainActor [weak self] in
            let data: Data? = await Task.detached(priority: .userInitiated) { m.faces.isEmpty ? nil : MeshScan.ply(m, MeshScan.colors(for: m, from: kfs)) }.value
            guard let self else { return }
            if let data { self.finish(Result(name: "Photo-real scan", data: data)) }
            else { self.finishing = false; self.doneButton.isEnabled = true; self.cancelButton.isEnabled = true; self.status.text = "The scan has no surfaces yet. Keep scanning, then tap Done." }
        }
    }

    private func finish(_ r: Result?) {
        UIApplication.shared.isIdleTimerDisabled = false
        arView?.session.pause()
        guard let d = done else { return }
        done = nil
        dismiss(animated: true) { d(r) }
    }
}
