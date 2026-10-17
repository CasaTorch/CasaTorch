package com.casatorch.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
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
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.coroutines.suspendCancellableCoroutine
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * window.CasaNative's other half. Calls arrive only from the main frame of the app's own screens or a home you signed
 * in to (checked in MainActivity); answers go back with window.__casaReply(id, ok, data).
 */
class Bridge(private val a: MainActivity) {
    class Failure(msg: String) : Exception(msg)
    private companion object { const val CLIP_LABEL = "CasaTorch setup key" }

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
                "warning" -> HapticFeedbackConstants.LONG_PRESS
                "light" -> HapticFeedbackConstants.KEYBOARD_TAP
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
        "copy" -> {
            val cm = a.getSystemService(android.content.ClipboardManager::class.java)
            val clip = android.content.ClipData.newPlainText(CLIP_LABEL, x.optString("text"))
            // a setup key: marked sensitive so Android doesn't show it in the clipboard preview, and gone after 2 minutes
            if (Build.VERSION.SDK_INT >= 33) clip.description.extras = android.os.PersistableBundle().apply { putBoolean("android.content.extra.IS_SENSITIVE", true) }
            cm.setPrimaryClip(clip)
            a.web.postDelayed({ runCatching { if (cm.primaryClipDescription?.label == CLIP_LABEL) cm.clearPrimaryClip() } }, 120_000)
            true
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
        "probe" -> {
            // the app's own screens asking "is there a CasaTorch at this address?" - with the exact reason when there isn't
            if (!fromShell) throw Failure("Not allowed here.")
            val u = Uri.parse(x.optString("url"))
            if ((u.scheme != "http" && u.scheme != "https") || u.host.isNullOrEmpty()) throw Failure("Not allowed here.")
            probe(u, x.optInt("timeout", 5000).coerceIn(1000, 15000))
        }
        "discover" -> {
            // the app's own Find screen: CasaTorch boxes announcing themselves on this Wi-Fi (Bonjour, "_casatorch._tcp")
            if (!fromShell) throw Failure("Not allowed here.")
            JSONArray(discover(x.optLong("timeout", 3000).coerceIn(1000, 8000)))
        }
        "scanQR" -> scanQR()
        "homes" -> JSONArray(HomeStore.homes.sortedByDescending { it.last }.map { it.toJson().apply { if (it.last > 0) put("last", java.time.Instant.ofEpochMilli(it.last).toString()) else remove("last") } })
        "saveHome" -> {
            if (!fromShell) throw Failure("Not allowed here.")
            val id = x.optString("id"); val name = x.optString("name"); val token = x.optString("token")
            if (!Regex("^[A-Za-z0-9_-]{8,40}$").matches(id) || name.isEmpty() || token.isEmpty()) throw Failure("That sign-in didn't come back right.")
            val ad = x.optJSONObject("addresses") ?: JSONObject(); val u = x.optJSONObject("user") ?: JSONObject()
            fun clean(k: String) = if (ad.isNull(k)) null else ad.optString(k).takeIf { s -> Home.allowed(Uri.parse(s)) }
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

    /** { status, json?, net } for any answer; { error, net } when there was none: offline, dns, timeout, refused, tls, insecure. */
    private suspend fun probe(u: Uri, ms: Int): JSONObject = withContext(Dispatchers.IO) {
        val net = Net.json(a)
        if (!Home.allowed(u)) return@withContext JSONObject().put("error", "insecure").put("net", net)
        try {
            val c = (URL(u.toString()).openConnection() as HttpURLConnection).apply {
                connectTimeout = ms; readTimeout = ms; useCaches = false; instanceFollowRedirects = false   // a redirect is an answer: usually a Wi-Fi sign-in page
                setRequestProperty("Accept", "application/json")
            }
            try {
                val code = c.responseCode
                val out = JSONObject().put("status", code).put("net", net)
                if (code in 200..299) runCatching { out.put("json", JSONObject(c.inputStream.bufferedReader().use { it.readText() }.take(256_000))) }
                // 403 from the secure address away from home on Basic says so in JSON ({ away, needsPro }): the screens show it
                else if (code == 403) runCatching { c.errorStream?.bufferedReader()?.use { it.readText() }?.take(16_000)?.let { out.put("json", JSONObject(it)) } }
                out
            } finally { c.disconnect() }
        } catch (e: Exception) {
            val online = net.optBoolean("online")
            val kind = when (e) {
                is java.net.UnknownHostException -> if (online) "dns" else "offline"
                is java.net.SocketTimeoutException -> "timeout"
                is java.net.ConnectException, is java.net.NoRouteToHostException -> if (online) "refused" else "offline"
                is javax.net.ssl.SSLException -> "tls"
                is java.net.UnknownServiceException -> "insecure"   // plain http refused by the network rules
                else -> if (online) "other" else "offline"
            }
            JSONObject().put("error", kind).put("net", net)
        }
    }

    /**
     * CasaTorch boxes on this network that announce themselves (mDNS / DNS-SD), as "http://address:port" for the shell
     * to check with probe - nothing here is trusted until that answers. Never throws: no Wi-Fi or no multicast, no list.
     */
    private suspend fun discover(ms: Long): List<String> {
        val nsd = a.getSystemService(NsdManager::class.java) ?: return emptyList()
        val found = java.util.Collections.synchronizedList(mutableListOf<NsdServiceInfo>())
        val listener = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(serviceType: String) {}
            override fun onDiscoveryStopped(serviceType: String) {}
            override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {}
            override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {}
            override fun onServiceFound(info: NsdServiceInfo) { found.add(info) }
            override fun onServiceLost(info: NsdServiceInfo) {}
        }
        if (runCatching { nsd.discoverServices("_casatorch._tcp", NsdManager.PROTOCOL_DNS_SD, listener) }.isFailure) return emptyList()
        try { delay(ms) } finally { runCatching { nsd.stopServiceDiscovery(listener) } }
        val out = mutableListOf<String>()
        for (info in synchronized(found) { found.toList() }.distinctBy { it.serviceName }.take(8)) {   // one at a time: older Android resolves one service at a time
            val r = withTimeoutOrNull(2500L) { resolve(nsd, info) } ?: continue
            @Suppress("DEPRECATION") val ip = r.host?.hostAddress ?: continue
            if (ip.contains('%') || r.port !in 1..65535) continue   // a scoped IPv6 address can't go in a web address
            out.add(if (ip.contains(':')) "http://[$ip]:${r.port}" else "http://$ip:${r.port}")
        }
        return out.distinct().filter { Home.allowed(Uri.parse(it)) }
    }
    @Suppress("DEPRECATION")
    private suspend fun resolve(nsd: NsdManager, info: NsdServiceInfo): NsdServiceInfo? = suspendCancellableCoroutine { c ->
        val l = object : NsdManager.ResolveListener {
            override fun onResolveFailed(i: NsdServiceInfo, errorCode: Int) { if (c.isActive) c.resume(null) }
            override fun onServiceResolved(i: NsdServiceInfo) { if (c.isActive) c.resume(i) }
        }
        if (runCatching { nsd.resolveService(info, l) }.isFailure && c.isActive) c.resume(null)
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
