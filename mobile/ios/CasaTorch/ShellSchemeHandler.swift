import Foundation
import UniformTypeIdentifiers
import WebKit

/// Serves the app's own screens (welcome, sign-in, your homes) from inside the app at casatorch-app://app/…,
/// so they work with no network and have an origin your CasaTorch recognizes.
final class ShellSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "casatorch-app"
    private let root = Bundle.main.resourceURL!.appendingPathComponent("shell", isDirectory: true)

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { task.didFailWithError(URLError(.badURL)); return }
        var path = url.path.isEmpty || url.path == "/" ? "index.html" : String(url.path.dropFirst())
        if path.contains("..") { path = "index.html" }
        let file = root.appendingPathComponent(path)
        guard file.standardizedFileURL.path.hasPrefix(root.standardizedFileURL.path), let data = try? Data(contentsOf: file) else {
            task.didReceive(HTTPURLResponse(url: url, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: nil)!); task.didFinish(); return
        }
        let type = UTType(filenameExtension: file.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        let headers = ["Content-Type": type.hasPrefix("text/") || type.contains("javascript") ? "\(type); charset=utf-8" : type, "Cache-Control": "no-store"]
        task.didReceive(HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)!)
        task.didReceive(data)
        task.didFinish()
    }
    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}
