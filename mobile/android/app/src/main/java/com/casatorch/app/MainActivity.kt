package com.casatorch.app

import android.annotation.SuppressLint
import androidx.appcompat.app.AlertDialog
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.JsPromptResult
import android.webkit.JsResult
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.browser.customtabs.CustomTabsIntent
import androidx.core.content.ContextCompat
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.lifecycleScope
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import androidx.webkit.ScriptHandler
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import kotlin.coroutines.resume

/**
 * The whole app is one web view: the app's own screens (served from inside the app) until you're signed in, then your
 * CasaTorch itself, with the app's extras (fingerprint lock, alerts, haptics) through the bridge. It only ever shows
 * your own CasaTorch: other links open in the browser.
 */
class MainActivity : AppCompatActivity() {
    companion object {
        const val SHELL_ORIGIN = "https://appassets.androidplatform.net"
        const val SHELL = "$SHELL_ORIGIN/assets/shell/index.html"
        const val EXTRA_URL = "ct_url"
        const val EXTRA_HOME = "ct_home"
        private const val RELOCK_AFTER_MS = 120_000L
    }

    lateinit var web: WebView
    private lateinit var swipe: SwipeRefreshLayout
    private lateinit var root: FrameLayout
    private lateinit var lockView: View
    private lateinit var bridge: Bridge
    private var scriptHandler: ScriptHandler? = null
    private var bridgeOrigins: Set<String> = emptySet()
    private var openingHome: Home? = null
    private var backgroundedAt = 0L
    private var unlocking = false
    var fullscreen = false
        set(v) { field = v; applyFullscreen() }
    /** Sign-ins read since the last unlock, in memory only (forgotten after a while in the background). */
    val tokenCache = mutableMapOf<String, String>()

    private val assetLoader by lazy { WebViewAssetLoader.Builder().addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this)).build() }
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private val pickFiles = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(r.resultCode, r.data)); fileCallback = null
    }

    // MARK: - setting up
    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        HomeStore.init(applicationContext)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) { needsNewerWebView(); return }

        root = FrameLayout(this)
        web = WebView(this)
        swipe = SwipeRefreshLayout(this).apply {
            addView(web, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            setOnChildScrollUpCallback { _, _ -> web.canScrollVertically(-1) || fullscreen }
            setOnRefreshListener { web.evaluateJavascript("window.casatorchRefresh ? (Promise.resolve(window.casatorchRefresh()), 1) : (location.reload(), 1)") { postDelayed({ isRefreshing = false }, 400) } }
            setColorSchemeColors(getColor(R.color.accent))
        }
        root.addView(swipe, FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)
        lockView = buildLockView()
        root.addView(lockView, FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)
        setContentView(root)
        paintBars()
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val b = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime())
            if (fullscreen) v.setPadding(0, 0, 0, insets.getInsets(WindowInsetsCompat.Type.ime()).bottom) else v.setPadding(b.left, b.top, b.right, b.bottom)
            insets
        }

        with(web.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            allowContentAccess = false
            // the app's screens are served over https from inside the app; a box that only has a plain address yet is http
            mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            userAgentString = "$userAgentString CasaTorchApp/${BuildConfig.VERSION_NAME} (Android)"
            setSupportMultipleWindows(false)
            setGeolocationEnabled(false)
        }
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        CookieManager.getInstance().apply { setAcceptCookie(true); setAcceptThirdPartyCookies(web, false) }
        web.setBackgroundColor(Color.TRANSPARENT)
        web.webViewClient = Client()
        web.webChromeClient = Chrome()
        bridge = Bridge(this)
        installListener()
        installBridge()

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() { if (fullscreen) fullscreen = false else if (web.canGoBack()) web.goBack() else moveTaskToBack(true) }
        })
        if (HomeStore.biometricLock && !canLock()) HomeStore.lockLost()   // the phone's screen lock was removed
        applyLockPrivacy()
        if (HomeStore.biometricLock && HomeStore.current != null) { showLock(); openShell("homes"); unlock() } else start()
        handleIntent(intent)
    }

    private fun needsNewerWebView() {
        setContentView(TextView(this).apply {
            text = "CasaTorch needs a newer Android System WebView. Update it in the Play Store, then open CasaTorch again."
            setPadding(64, 64, 64, 64); textSize = 18f; gravity = Gravity.CENTER; setTextColor(Color.WHITE); setBackgroundColor(getColor(R.color.launch_bg))
        })
    }

    /** The bands behind the status and navigation bars take the page's own background (dark unless you chose light). */
    private fun paintBars(color: Int = Color.parseColor("#070A12")) {
        root.setBackgroundColor(color)
        val light = androidx.core.graphics.ColorUtils.calculateLuminance(color) > 0.5
        WindowInsetsControllerCompat(window, root).apply { isAppearanceLightStatusBars = light; isAppearanceLightNavigationBars = light }
    }
    private fun matchPageColor() {
        web.evaluateJavascript("(() => { const v = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(); return v || getComputedStyle(document.body).backgroundColor; })()") { r ->
            val v = r?.trim('"')?.trim() ?: return@evaluateJavascript
            val c = runCatching {
                if (v.startsWith("#")) Color.parseColor(if (v.length == 4) "#" + v.drop(1).map { "$it$it" }.joinToString("") else v)
                else Regex("""rgba?\((\d+),\s*(\d+),\s*(\d+)""").find(v)!!.destructured.let { (r1, g, b) -> Color.rgb(r1.toInt(), g.toInt(), b.toInt()) }
            }.getOrNull() ?: return@evaluateJavascript
            paintBars(c)
        }
    }

    private fun applyFullscreen() {
        val c = WindowInsetsControllerCompat(window, root)
        if (fullscreen) { c.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE; c.hide(WindowInsetsCompat.Type.systemBars()) }
        else c.show(WindowInsetsCompat.Type.systemBars())
        ViewCompat.requestApplyInsets(root)
    }

    /**
     * window.CasaNative: the bridge script goes only into the app's own screens and the homes you signed in to, and
     * every call is checked again (address and main frame) before anything runs - frames inside a page never get in.
     * The message listener is registered once: replacing it would leave an open page talking to nobody.
     */
    private fun installListener() {
        WebViewCompat.addWebMessageListener(web, "CasaAndroid", setOf("*")) { _, message, origin, isMainFrame, _ ->
            val o = origin.toString().trimEnd('/')
            if (isMainFrame && isTrustedOrigin(o)) message.data?.let { bridge.handle(it, o == SHELL_ORIGIN) }
        }
    }
    fun installBridge() {
        val want = setOf(SHELL_ORIGIN) + HomeStore.origins + (openingHome?.origins ?: emptySet())
        if (want == bridgeOrigins && scriptHandler != null) return
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) { bridgeOrigins = want; return }
        val js = "window.__casaInfo = ${bridge.infoJson()};\n" + bridgeJs
        val next = try { WebViewCompat.addDocumentStartJavaScript(web, js, want) } catch (_: IllegalArgumentException) {
            // an address Android won't take as a rule (very unusual): the script goes everywhere, the bridge still refuses other pages
            WebViewCompat.addDocumentStartJavaScript(web, js, setOf("*"))
        }
        scriptHandler?.remove(); scriptHandler = next
        bridgeOrigins = want
    }
    private val bridgeJs by lazy { assets.open("shell/bridge.js").bufferedReader().use { it.readText() } }

    // MARK: - what's on screen
    fun start() { HomeStore.current?.let { openHome(it.id) } ?: openShell("welcome") }
    private var openJob: Job? = null
    fun openShell(hash: String) { openJob?.cancel(); openingHome = null; web.loadUrl("$SHELL#$hash") }

    /** Opening a home: find an address that answers, hand the web view the sign-in, load it. */
    fun openHome(id: String, path: String? = null) {
        val home = HomeStore.home(id) ?: return openShell("welcome")
        openJob?.cancel()
        openingHome = home
        installBridge()
        openJob = lifecycleScope.launch {
            val token = tokenCache[id] ?: try { HomeStore.token(id) } catch (_: NeedsUnlock) { if (path != null) pendingAlert = path to id; showLock(); unlock(); return@launch }
            if (token == null) return@launch openShell("signedout=$id")
            tokenCache[id] = token
            val base = firstAnswering(home.candidates) ?: return@launch openShell("unreachable=$id")
            if (!isActive) return@launch
            setSessionCookie(token, home)
            HomeStore.touch(id, base)
            web.loadUrl(Home.originOf(base) + (path ?: "/"))
            refreshPushToken(home, base, token)
        }
    }
    /** Back from the lock: hand the sign-in back and carry on where you were. */
    private fun resume() {
        val id = currentHomeId()
        val onHome = web.url?.startsWith(SHELL_ORIGIN) == false
        if (id == null || !onHome) {
            // the app's own screen behind the lock stays (pairing a phone, say), unless it was just the homes list
            val u = web.url
            if (u == null || u.endsWith("#homes")) HomeStore.current?.let { openHome(it.id) } ?: start()
            return
        }
        val home = HomeStore.home(id) ?: return start()
        val token = tokenCache[id] ?: runCatching { HomeStore.token(id) }.getOrNull() ?: return openShell("signedout=$id")
        tokenCache[id] = token
        setSessionCookie(token, home)
        web.evaluateJavascript("window.casatorchRefresh && window.casatorchRefresh(); 1", null)
    }

    private suspend fun firstAnswering(list: List<Uri>): Uri? = withContext(Dispatchers.IO) {
        list.firstOrNull { u ->
            runCatching {
                val c = (URL(u.buildUpon().path("/api/app/hello").build().toString()).openConnection() as HttpURLConnection).apply { connectTimeout = 3500; readTimeout = 3500; useCaches = false; instanceFollowRedirects = false }
                try { c.responseCode == 200 && JSONObject(c.inputStream.bufferedReader().use { it.readText() }).optBoolean("casatorch") } finally { c.disconnect() }
            }.getOrDefault(false)
        }
    }

    /** The sign-in, as the cookie your CasaTorch expects, on each of the home's addresses. */
    fun setSessionCookie(token: String, home: Home) {
        val cm = CookieManager.getInstance()
        val plainHosts = home.candidates.filter { it.scheme == "http" }.mapNotNull { it.host?.lowercase() }.toSet()
        for (u in home.candidates) {
            val secure = u.scheme == "https" && u.host?.lowercase() !in plainHosts
            cm.setCookie(Home.originOf(u), "casatorch_session=$token; Path=/; HttpOnly; SameSite=Lax" + if (secure) "; Secure" else "")
        }
        cookiesDropped = false
        cm.flush()
    }
    /** Locking: the sign-in cookies leave the web view until the lock opens again. */
    private var cookiesDropped = false
    fun dropSessionCookies() {
        val cm = CookieManager.getInstance()
        for (h in HomeStore.homes) for (u in h.candidates) {
            cm.setCookie(Home.originOf(u), "casatorch_session=; Path=/; Max-Age=0")
            if (u.scheme == "https") cm.setCookie(Home.originOf(u), "casatorch_session=; Path=/; Max-Age=0; Secure")
        }
        cookiesDropped = true
        cm.flush()
    }

    /** Google changes a phone's push address now and then; the home gets the new one quietly. */
    private fun refreshPushToken(home: Home, base: Uri, token: String) {
        val had = HomeStore.pushToken(home.id) ?: return
        val now = getSharedPreferences("casatorch", MODE_PRIVATE).getString("fcm", null) ?: return
        if (now == had) return
        lifecycleScope.launch(Dispatchers.IO) {
            runCatching {
                val c = (URL(base.buildUpon().path("/api/app/push").build().toString()).openConnection() as HttpURLConnection).apply {
                    requestMethod = "PUT"; doOutput = true; connectTimeout = 5000; readTimeout = 5000
                    setRequestProperty("Content-Type", "application/json"); setRequestProperty("Authorization", "Bearer $token")
                }
                c.outputStream.use { it.write(JSONObject().put("token", now).toString().toByteArray()) }
                if (c.responseCode == 200) HomeStore.setPushToken(home.id, now)
                c.disconnect()
            }
        }
    }

    // MARK: - only your own CasaTorch in here
    private fun isTrusted(u: Uri): Boolean {
        if (Home.originOf(u) == SHELL_ORIGIN) return true
        val host = u.host?.lowercase() ?: return false
        return HomeStore.homes.any { host in it.hosts } || (openingHome?.hosts?.contains(host) ?: false)
    }
    fun isTrustedOrigin(origin: String): Boolean {
        if (origin == SHELL_ORIGIN) return true
        return HomeStore.homes.any { origin in it.origins } || (openingHome?.origins?.contains(origin) ?: false)
    }
    fun currentHomeId(): String? {
        val host = web.url?.let(Uri::parse)?.host?.lowercase() ?: return openingHome?.id
        return HomeStore.homes.firstOrNull { host in it.hosts }?.id ?: openingHome?.id
    }

    fun openOutside(u: Uri) {
        if (u.scheme == "http" || u.scheme == "https") runCatching { CustomTabsIntent.Builder().setShowTitle(true).build().launchUrl(this, u) }
        else runCatching { startActivity(Intent(Intent.ACTION_VIEW, u)) }
    }

    private inner class Client : WebViewClient() {
        override fun shouldInterceptRequest(view: WebView, req: WebResourceRequest): WebResourceResponse? = assetLoader.shouldInterceptRequest(req.url)
        override fun shouldOverrideUrlLoading(view: WebView, req: WebResourceRequest): Boolean {
            val u = req.url
            when (u.scheme) {
                "casatorch" -> { handlePairLink(u); return true }
                "otpauth", "mailto", "tel" -> { openOutside(u); return true }
                "about", "blob", "data" -> return false
            }
            if (isTrusted(u)) {
                // the dashboard sending you to its sign-in page means this phone was signed out there
                // (while locked the cookies are out on purpose: that isn't a sign-out, so nothing is forgotten)
                if (req.isForMainFrame && u.path?.endsWith("/login.html") == true && (cookiesDropped || lockView.visibility == View.VISIBLE)) return true
                if (req.isForMainFrame && u.path?.endsWith("/login.html") == true) currentHomeId()?.let { id ->
                    dropSessionCookies(); tokenCache.remove(id); HomeStore.dropToken(id); openShell("signedout=$id"); return true
                }
                return false
            }
            if (req.isForMainFrame) openOutside(u)
            return true
        }
        override fun onReceivedError(view: WebView, req: WebResourceRequest, err: WebResourceError) {
            if (req.isForMainFrame && Home.originOf(req.url) != SHELL_ORIGIN) openingHome?.let { openShell("unreachable=${it.id}") }
        }
        override fun onPageFinished(view: WebView, url: String?) {
            swipe.isRefreshing = false
            matchPageColor()
            // older WebViews without document-start scripts: the bridge goes in as soon as the page is there
            if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT) && url != null && isTrustedOrigin(Home.originOf(Uri.parse(url))))
                view.evaluateJavascript("window.__casaInfo = ${bridge.infoJson()};\n$bridgeJs", null)
        }
        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            openJob?.cancel(); (view.parent as? ViewGroup)?.removeView(view); view.destroy(); recreate(); return true
        }
    }

    private inner class Chrome : WebChromeClient() {
        override fun onShowFileChooser(view: WebView, cb: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
            fileCallback?.onReceiveValue(null); fileCallback = cb
            return runCatching { pickFiles.launch(params.createIntent()); true }.getOrElse { fileCallback = null; false }
        }
        // the dashboard never needs the camera or microphone inside the page
        override fun onPermissionRequest(request: PermissionRequest) { request.deny() }
        override fun onJsAlert(view: WebView, url: String?, message: String?, result: JsResult): Boolean {
            AlertDialog.Builder(this@MainActivity).setMessage(message).setPositiveButton(android.R.string.ok) { _, _ -> result.confirm() }.setOnCancelListener { result.cancel() }.show(); return true
        }
        override fun onJsConfirm(view: WebView, url: String?, message: String?, result: JsResult): Boolean {
            AlertDialog.Builder(this@MainActivity).setMessage(message).setPositiveButton(android.R.string.ok) { _, _ -> result.confirm() }.setNegativeButton(android.R.string.cancel) { _, _ -> result.cancel() }.setOnCancelListener { result.cancel() }.show(); return true
        }
        override fun onJsPrompt(view: WebView, url: String?, message: String?, def: String?, result: JsPromptResult): Boolean {
            val input = EditText(this@MainActivity).apply { setText(def) }
            AlertDialog.Builder(this@MainActivity).setMessage(message).setView(input).setPositiveButton(android.R.string.ok) { _, _ -> result.confirm(input.text.toString()) }.setNegativeButton(android.R.string.cancel) { _, _ -> result.cancel() }.setOnCancelListener { result.cancel() }.show(); return true
        }
    }

    // MARK: - links from outside: a pairing QR scanned with the camera app, an alert tapped
    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); handleIntent(intent) }
    private fun handleIntent(i: Intent?) {
        i ?: return
        i.data?.let { if (it.scheme == "casatorch") handlePairLink(it) }
        i.getStringExtra(EXTRA_URL)?.let { openAlert(it, i.getStringExtra(EXTRA_HOME)); i.removeExtra(EXTRA_URL) }
    }
    fun handlePairLink(u: Uri) {
        if (u.scheme != "casatorch" || u.host != "pair") return
        openShell("pair=" + Uri.encode(u.toString()))
    }
    private fun openAlert(path: String, homeId: String?) {
        if (lockView.visibility == View.VISIBLE) { pendingAlert = path to homeId; return }
        val p = if (path.startsWith("/")) path else "/#alerts"
        val base = web.url?.let(Uri::parse)?.takeIf { Home.originOf(it) != SHELL_ORIGIN && isTrusted(it) }
        // a different home, or the app still opening: open that home straight at the alert
        if (base == null || (homeId != null && homeId != currentHomeId())) { (homeId ?: HomeStore.current?.id)?.let { openHome(it, p) }; return }
        web.loadUrl(Home.originOf(base) + p)
    }
    private var pendingAlert: Pair<String, String?>? = null

    // MARK: - the lock (fingerprint, face or screen lock)
    val lockAuthenticators get() = if (Build.VERSION.SDK_INT >= 30) BIOMETRIC_STRONG or DEVICE_CREDENTIAL else BIOMETRIC_STRONG
    fun canLock() = BiometricManager.from(this).canAuthenticate(lockAuthenticators) == BiometricManager.BIOMETRIC_SUCCESS

    /** Shows the system prompt; true when it's you. */
    suspend fun authenticate(title: String): Boolean = suspendCancellableCoroutine { cont ->
        val prompt = BiometricPrompt(this, ContextCompat.getMainExecutor(this), object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(r: BiometricPrompt.AuthenticationResult) { if (cont.isActive) cont.resume(true) }
            override fun onAuthenticationError(code: Int, msg: CharSequence) { if (cont.isActive) cont.resume(false) }
        })
        val info = BiometricPrompt.PromptInfo.Builder().setTitle(title).setAllowedAuthenticators(lockAuthenticators)
            .apply { if (Build.VERSION.SDK_INT < 30) setNegativeButtonText("Cancel") }.build()
        prompt.authenticate(info)
    }

    private fun unlock() {
        if (unlocking) return
        unlocking = true
        lifecycleScope.launch {
            val ok = authenticate("Unlock CasaTorch")
            unlocking = false
            if (!ok) return@launch
            lockView.animate().alpha(0f).setDuration(220).withEndAction { lockView.visibility = View.GONE; lockView.alpha = 1f }.start()
            val alert = pendingAlert; pendingAlert = null
            if (alert != null) { HomeStore.current?.let { openHome(alert.second ?: it.id, alert.first) } } else resume()
        }
    }
    fun showLock() {
        if (!HomeStore.biometricLock) return
        lockView.visibility = View.VISIBLE; lockView.bringToFront()
        dropSessionCookies()
    }
    /** With the lock on, the app's content is hidden from the recent-apps screen. */
    fun applyLockPrivacy() {
        if (Build.VERSION.SDK_INT >= 33) setRecentsScreenshotEnabled(!HomeStore.biometricLock)
        else if (HomeStore.biometricLock) window.addFlags(WindowManager.LayoutParams.FLAG_SECURE) else window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
    }

    override fun onStop() {
        super.onStop()
        if (!::lockView.isInitialized) return
        backgroundedAt = SystemClock.elapsedRealtime()
        if (HomeStore.biometricLock && HomeStore.homes.isNotEmpty() && !unlocking) showLock()
    }
    override fun onStart() {
        super.onStart()
        if (!::lockView.isInitialized || lockView.visibility != View.VISIBLE || backgroundedAt == 0L) return
        if (unlocking && SystemClock.elapsedRealtime() - backgroundedAt > 2000) unlocking = false   // a prompt that never showed
        if (unlocking) return
        if (SystemClock.elapsedRealtime() - backgroundedAt < RELOCK_AFTER_MS) {
            // back within two minutes: no prompt, the sign-in comes back from memory
            val id = currentHomeId(); val t = id?.let { tokenCache[it] }; val h = id?.let { HomeStore.home(it) }
            if (t != null && h != null) { setSessionCookie(t, h); lockView.visibility = View.GONE; pendingAlert?.let { (p, hid) -> pendingAlert = null; openAlert(p, hid) }; return }
        }
        tokenCache.clear(); unlock()
    }

    private fun buildLockView(): View = FrameLayout(this).apply {
        setBackgroundColor(getColor(R.color.launch_bg)); visibility = View.GONE; isClickable = true; isFocusable = true
        val col = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL }
        col.addView(ImageView(context).apply { setImageResource(R.drawable.ic_launcher_foreground) }, LinearLayout.LayoutParams(dp(120), dp(120)))
        col.addView(TextView(context).apply { setText(R.string.locked); setTextColor(Color.WHITE); textSize = 22f; gravity = Gravity.CENTER; setPadding(0, dp(8), 0, dp(24)) })
        col.addView(Button(context).apply {
            setText(R.string.unlock); isAllCaps = false; textSize = 17f; setTextColor(Color.parseColor("#05121C"))
            background = android.graphics.drawable.GradientDrawable().apply { cornerRadius = dp(14).toFloat(); setColor(getColor(R.color.accent)) }
            setPadding(dp(36), dp(14), dp(36), dp(14)); setOnClickListener { unlock() }
        })
        addView(col, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER))
    }
    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()
}
