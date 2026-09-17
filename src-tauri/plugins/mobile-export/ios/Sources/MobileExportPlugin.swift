import SwiftRs
import Tauri
import UIKit
import WebKit

private struct ShareArgs: Decodable { let path: String }

class MobileExportPlugin: Plugin {
    @objc public func share(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(ShareArgs.self)
        let file = URL(fileURLWithPath: args.path).resolvingSymlinksInPath()
        let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        let root = caches.appendingPathComponent(Bundle.main.bundleIdentifier ?? "org.kenkui.studio")
            .appendingPathComponent("kenkui-exports").resolvingSymlinksInPath()
        guard file.path.hasPrefix(root.path + "/"), file.pathExtension == "m4b",
              FileManager.default.fileExists(atPath: file.path) else {
            invoke.reject("Invalid audiobook export")
            return
        }
        DispatchQueue.main.async {
            guard let presenter = self.manager.viewController, presenter.presentedViewController == nil else {
                invoke.reject("Close the current sheet before sharing an audiobook")
                return
            }
            let sheet = UIActivityViewController(activityItems: [file], applicationActivities: nil)
            if let popover = sheet.popoverPresentationController {
                popover.sourceView = presenter.view
                popover.sourceRect = CGRect(x: presenter.view.bounds.midX, y: presenter.view.bounds.midY, width: 1, height: 1)
                popover.permittedArrowDirections = []
            }
            sheet.completionWithItemsHandler = { _, _, _, error in
                if let error = error { invoke.reject(error.localizedDescription) }
                else { invoke.resolve() }
            }
            presenter.present(sheet, animated: true)
        }
    }
}

@_cdecl("init_plugin_mobile_export")
func initPlugin() -> Plugin { MobileExportPlugin() }
