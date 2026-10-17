package com.casatorch.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.view.HapticFeedbackConstants
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import org.json.JSONArray
import org.json.JSONObject
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * window.CasaNative's other half. Calls arrive only from the main frame of the app's own screens or a home you signed
 * in to (checked in MainActivity); answers go back with window.__casaReply(id, ok, data).
 */
class Bridge(private val a: MainActivity) {
    class Failure(msg: String) : Exception(msg)

    private var askNotify: ((Boolean) -> Unit)? = null
    private val notifyPermission = a.registerForActivityResult(ActivityResultContracts.RequestPermission()) { ok -> askNotify?.invoke(ok); askNotify = null }

    fun infoJson(): String = JSONObject().put("platform", "android").put("version", BuildConfig.VERSION_NAME).put("device", Build.MODEL).put("lidar", false).toString()

    fun handle(raw: String, fromShell: Boolean) {
        val m = runCatching { JSONObject(raw) }.getOrNull() ?: return
        val id = m.optInt("id", -1).takeIf { it >= 0 } ?: return
        val cmd = m.optString("cmd")
        val args = m.optJSONObject("args") ?: JSONObject()
        a.lifecycleScope.launch {
            try { reply(id, true, run(cmd, args, fromShell)) } catch (e: Exception) { reply(id, false, JSONObject().put("message", e.message ?: "That didn't work.")) }
        }
    }

    private suspend fun run(cmd: String, x: JSONObject, fromShell: Boolean): Any? = when (cmd) {
        "haptic" -> {
            val k = when (x.optString("kind")) {
                "success" -> if (Build.VERSION.SDK_INT >= 30) HapticFeedbackConstants.CONFIRM else HapticFeedbackConstants.VIRTUAL_KEY
                "error" -> if (Build.VERSION.SDK_INT >= 30) HapticFeedbackConstants.REJECT else HapticFeedbackConstants.LONG_PRESS
                "medium" -> HapticFeedbackConstants.VIRTUAL_KEY
                else -> HapticFeedbackConstants.CLOCK_TICK
            }
            a.web.performHapticFeedback(k); null
        }
        "fullscreen" -> { a.fullscreen = x.optBoolean("on"); null }
        "openExternal" -> { Uri.parse(x.optString("url")).takeIf { it.scheme == "http" || it.scheme == "https" }?.let(a::openOutside); null }
        "share" -> {
            val text = listOf(x.optString("text"), x.optString("url")).filter { it.isNotEmpty() }.joinToString("\n")
            a.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text), null)); true
        }
        "deviceInfo" -> JSONObject().put("name", deviceName()).put("platform", "android").put("model", Build.MODEL.take(40)).put("app", BuildConfig.VERSION_NAME)
        "biometrics" -> {
            val pm = a.packageManager
            val type = when {
                pm.hasSystemFeature(PackageManager.FEATURE_FINGERPRINT) -> "fingerprint"
                pm.hasSystemFeature(PackageManager.FEATURE_FACE) -> "face"
                else -> "fingerprint"
            }
            JSONObject().put("available", a.canLock()).put("type", type).put("enabled", HomeStore.biometricLock)
        }
        "setBiometricLock" -> {
            val on = x.optBoolean("on")
            if (on && !a.canLock()) throw Failure("Set up a fingerprint or screen lock in your phone's Settings first.")
            if (!a.authenticate(if (on) "Turn on the CasaTorch lock" else "Turn off the CasaTorch lock")) false
            else HomeStore.setLock(on).also { a.applyLockPrivacy() }
        }
        "pushEnable" -> {
            val id = HomeStore.currentId ?: a.currentHomeId() ?: throw Failure("Sign in to a home first.")
            if (!CasaApp.pushConfigured(a)) throw Failure("Alerts aren't available in this build of the app yet.")
            if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(a, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                if (askNotify != null) throw Failure("Answer the question on screen first.")
                val ok = suspendCancellableCoroutine { c -> askNotify = { if (c.isActive) c.resume(it) }; c.invokeOnCancellation { askNotify = null }; notifyPermission.launch(Manifest.permission.POST_NOTIFICATIONS) }
                if (!ok) throw Failure("Alerts are off for CasaTorch. Turn them on in Settings › Apps › CasaTorch › Notifications.")
            }
            if (!NotificationManagerCompat.from(a).areNotificationsEnabled()) throw Failure("Alerts are off for CasaTorch. Turn them on in Settings › Apps › CasaTorch › Notifications.")
            val fm = FirebaseMessaging.getInstance(); fm.isAutoInitEnabled = true
            val token = suspendCancellableCoroutine { c ->
                fm.token.addOnSuccessListener { c.resume(it) }.addOnFailureListener { c.resumeWithException(Failure("This phone couldn't get an alert address from Google. Check it's online and try again.")) }
            }
            HomeStore.setPushToken(id, token)
            a.getSharedPreferences("casatorch", android.content.Context.MODE_PRIVATE).edit().putString("fcm", token).apply()
            JSONObject().put("platform", "android").put("token", token).put("key", android.util.Base64.encodeToString(HomeStore.alertKey(id), android.util.Base64.NO_WRAP))
        }
        "lidar" -> JSONObject().put("available", false).put("why", "Scanning a room with LiDAR needs an iPhone Pro or iPad Pro. On Android, upload a room scan file made with another app instead.")
        "scanRoom" -> throw Failure("This phone has no LiDAR scanner.")
        "scanQR" -> scanQR()
        "homes" -> JSONArray(HomeStore.homes.sortedByDescending { it.last }.map { it.toJson().apply { if (it.last > 0) put("last", java.time.Instant.ofEpochMilli(it.last).toString()) else remove("last") } })
        "saveHome" -> {
            if (!fromShell) throw Failure("Not allowed here.")
            val id = x.optString("id"); val name = x.optString("name"); val token = x.optString("token")
            if (!Regex("^[A-Za-z0-9_-]{8,40}$").matches(id) || name.isEmpty() || token.isEmpty()) throw Failure("That sign-in didn't come back right.")
            val ad = x.optJSONObject("addresses") ?: JSONObject(); val u = x.optJSONObject("user") ?: JSONObject()
            fun clean(k: String) = if (ad.isNull(k)) null else ad.optString(k).takeIf { s -> Uri.parse(s).let { (it.scheme == "http" || it.scheme == "https") && !it.host.isNullOrEmpty() } }
            val h = Home(id, name.take(60), u.optString("name").ifEmpty { null }, u.optString("role").ifEmpty { null }, clean("lan"), clean("remote"), clean("plain"), clean("here"), System.currentTimeMillis())
            // with the lock on, saving needs a fresh unlock (signing in took longer than the few seconds it lasts)
            val saved = try { HomeStore.upsert(h, token) } catch (_: NeedsUnlock) { a.authenticate("Save the sign-in to ${h.name}") && HomeStore.upsert(h, token) }
            if (!saved) throw Failure("This phone's secure storage didn't take the sign-in.")
            a.tokenCache[id] = token
            a.installBridge()
            true
        }
        "openHome" -> { a.openHome(x.optString("id")); null }
        "removeHome" -> {
            if (!fromShell) throw Failure("Not allowed here.")
            val id = x.optString("id"); HomeStore.remove(id); a.tokenCache.remove(id); a.installBridge(); true
        }
        "switchHome" -> { a.openShell("homes"); null }
        "signOut" -> {
            a.currentHomeId()?.let { HomeStore.remove(it); a.tokenCache.remove(it) }
            a.dropSessionCookies()
            a.openShell(if (HomeStore.homes.isEmpty()) "welcome" else "homes"); null
        }
        else -> throw Failure("The app doesn't know \"$cmd\" - update it from Google Play.")
    }

    private fun deviceName(): String =
        (Settings.Global.getString(a.contentResolver, Settings.Global.DEVICE_NAME) ?: Build.MODEL).replace(Regex("[^\\p{L}\\p{N} '’._-]"), "").trim().take(40).ifEmpty { "Phone" }

    /** The pairing code, scanned by Google Play services' scanner (no camera permission needed for the app itself). */
    private suspend fun scanQR(): String? {
        val opts = GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build()
        val scanner = GmsBarcodeScanning.getClient(a, opts)
        return suspendCancellableCoroutine { c ->
            scanner.startScan()
                .addOnSuccessListener { b -> c.resume(b.rawValue?.takeIf { it.startsWith("casatorch://pair") }) }
                .addOnCanceledListener { c.resume(null) }
                .addOnFailureListener { c.resumeWithException(Failure("The scanner isn't ready on this phone. Type the pairing code instead.")) }
        }
    }

    private fun reply(id: Int, ok: Boolean, data: Any?) {
        val payload = when (data) {
            null -> "null"
            is JSONObject, is JSONArray -> data.toString()
            is Boolean -> data.toString()
            is String -> JSONObject.quote(data)
            else -> JSONObject.quote(data.toString())
        }
        a.web.evaluateJavascript("window.__casaReply && window.__casaReply($id, $ok, $payload); 1", null)
    }
}
