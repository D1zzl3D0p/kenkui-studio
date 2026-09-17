package org.kenkui.mobileexport

import android.app.Activity
import android.content.ClipData
import android.content.Intent
import androidx.core.content.FileProvider
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin
import java.io.File

@InvokeArg
class ShareArgs { lateinit var path: String }

@TauriPlugin
class MobileExportPlugin(private val activity: Activity) : Plugin(activity) {
    @Command
    fun share(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(ShareArgs::class.java)
            val file = File(args.path).canonicalFile
            val root = File(activity.cacheDir, "kenkui-exports").canonicalFile
            require(file.path.startsWith(root.path + File.separator) && file.isFile && file.extension == "m4b") {
                "Invalid audiobook export"
            }
            val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.kenkui.exports", file)
            val intent = Intent(Intent.ACTION_SEND).apply {
                type = "audio/mp4"
                putExtra(Intent.EXTRA_STREAM, uri)
                clipData = ClipData.newRawUri(file.name, uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            activity.runOnUiThread {
                try {
                    activity.startActivity(Intent.createChooser(intent, "Save or share audiobook"))
                    // Android does not report whether the receiving app saved the file.
                    // Rust retains this cache entry for a day so the recipient can read it.
                    invoke.resolve()
                } catch (error: Exception) { invoke.reject("Could not open the share sheet", error) }
            }
        } catch (error: Exception) { invoke.reject("Could not share this audiobook", error) }
    }
}
