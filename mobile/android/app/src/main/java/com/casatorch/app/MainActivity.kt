package com.casatorch.app

import android.annotation.SuppressLint
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Color
import android.net.ConnectivityManager
import android.net.Network
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
import androidx.appcompat.app.AlertDialog
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
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
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
    /** After the app's own screens hand over to a home, Back mustn't walk back into them. */
    private var clearHistoryOnLoad = false
    var fullscreen = false
        set(v) { field = v; applyFullscreen() }
    /** Sign-ins read since the last unlock, in memory only (forgotten after a while in the background). */
    val tokenCache = mutableMapOf<String, String>()

    private val assetLoader by lazy { WebViewAssetLoader.Builder().addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this)).build() }
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private val pickFiles = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(r.resultCode, r.data)); fileCallback = null
    }
    private val onShell get() = web.url?.startsWith(SHELL_ORIGIN) == true

    // MARK: - setting up
    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        HomeStore.init(applicationContext)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) { needsNewerWebView(); return }

        root = FrameLayout(this)
        web = buildWeb()
        swipe = SwipeRefreshLayout(this).apply {
            addView(web, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            // pull to refresh is for your home; the app's own screens retry by themselves
            setOnChildScrollUpCallback { _, _ -> web.canScrollVertically(-1) || fullscreen || onShell }
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
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)   // never in a release build
        CookieManager.getInstance().setAcceptCookie(true)
        bridge = Bridge(this)
        attachWeb()

        // Back (and the predictive back gesture): the app's own screen's Back, then the page's history, then home screen
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                when {
                    fullscreen -> fullscreen = false
                    onShell -> web.evaluateJavascript("window.__casaBack ? window.__casaBack() : false") { r -> if (r != "true") moveTaskToBack(true) }
                    web.canGoBack() -> web.goBack()
                    else -> moveTaskToBack(true)
                }
            }
        })
        if (HomeStore.biometricLock && !canLock()) HomeStore.lockLost()   // the phone's screen lock was removed
        applyLockPrivacy()
        if (HomeStore.biometricLock && HomeStore.current != null) { showLock(); openShell("homes"); unlock() } else start()
        // a link the app was opened with - but not again when Android rebuilds the screen or it's reopened from Recents
        val fromHistory = ((intent?.flags ?: 0) and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0
        if (savedInstanceState == null && !fromHistory) handleIntent(intent)
        watchNetwork()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun buildWeb(): WebView = WebView(this).apply {
        with(settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            allowContentAccess = false
            // the app's screens are served over https from inside the app; a box that only has a plain address yet is http (home network only)
            mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            userAgentString = "$userAgentString CasaTorchApp/${BuildConfig.VERSION_NAME} (Android)"
            setSupportMultipleWindows(false)
            setGeolocationEnabled(false)
            textZoom = textZoomFor(resources.configuration)
        }
        setBackgroundColor(Color.TRANSPARENT)
        alpha = 0f   // shown once the first page has drawn: no white flash
        webViewClient = Client()
        webChromeClient = Chrome()
        CookieManager.getInstance().setAcceptThirdPartyCookies(this, false)
        postDelayed({ reveal() }, 2500)   // never a blank screen, even if a page hangs
    }
    /** The bridge listener and script, on the current web view. */
    private fun attachWeb() { scriptHandler = null; bridgeOrigins = emptySet(); installListener(); installBridge() }
    private fun reveal() { if (web.alpha < 1f) web.animate().alpha(1f).setDuration(200).start() }
    /** The phone's font size, for the pages too (within reason, so the dashboard still fits). */
    private fun textZoomFor(c: Configuration) = (c.fontScale * 100).toInt().coerceIn(85, 150)
    override fun onConfigurationChanged(c: Configuration) {
        super.onConfigurationChanged(c)
        if (::web.isInitialized) web.settings.textZoom = textZoomFor(c)
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
     * The message listener is registered once per web view: replacing it would leave an open page talking to nobody.
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
    /** First screen: your home (after the lock), or - with more than one home and no remembered choice - which one. */
    fun start() { if (HomeStore.shouldAskAtLaunch) openShell("choose") else HomeStore.launchHome?.let { openHome(it.id) } ?: openShell("welcome") }
    private var openJob: Job? = null
    private var recheckJob: Job? = null
    fun openShell(hash: String) { openJob?.cancel(); recheckJob?.cancel(); openingHome = null; web.loadUrl("$SHELL#$hash") }

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
            val (base, hello) = firstAnswering(home.candidates) ?: return@launch openShell("unreachable=$id")
            HomeStore.learn(id, hello)   // secure access turned on (or off) since pairing: remember (or forget) the away-from-home address
            if (!isActive) return@launch
            setSessionCookie(token, HomeStore.home(id) ?: home, base)   // with what it just learned: the sign-in goes to the secure address too
            HomeStore.touch(id, base)
            if (onShell) clearHistoryOnLoad = true
            web.loadUrl(Home.originOf(base) + (path ?: "/"))
            refreshPushToken(home, base, token)
        }
    }
    /** Back from the lock: hand the sign-in back and carry on where you were. */
    private fun resume() {
        val id = currentHomeId()
        if (id == null || onShell) {
            // the app's own screen behind the lock stays (pairing a phone, say), unless it was just the homes list
            val u = web.url
            if (u == null || u.endsWith("#homes")) start()
            return
        }
        val home = HomeStore.home(id) ?: return start()
        val token = tokenCache[id] ?: runCatching { HomeStore.token(id) }.getOrNull() ?: return openShell("signedout=$id")
        tokenCache[id] = token
        setSessionCookie(token, home, web.url?.let(Uri::parse))
        web.evaluateJavascript("window.casatorchRefresh && window.casatorchRefresh(); 1", null)
        recheckHome(200)
    }

    /**
     * The first address that answers - all tried at once, with what the home says about itself. https addresses come
     * first (the secure one at home, then from anywhere), so a plain-http address is used only when none of them answers.
     */
    private suspend fun firstAnswering(list: List<Uri>, timeoutMs: Int = 4000): Pair<Uri, JSONObject>? = coroutineScope {
        val (secure, plain) = list.filter { Home.allowed(it) }.partition { it.scheme == "https" }
        val tries = (secure + plain).map { u ->
            async(Dispatchers.IO) {
                runCatching {
                    val c = (URL(u.buildUpon().path("/api/app/hello").build().toString()).openConnection() as HttpURLConnection).apply { connectTimeout = timeoutMs; readTimeout = timeoutMs; useCaches = false; instanceFollowRedirects = false }
                    try { if (c.responseCode == 200) JSONObject(c.inputStream.bufferedReader().use { it.readText() }).takeIf { it.optBoolean("casatorch") }?.let { u to it } else null } finally { c.disconnect() }
                }.getOrNull()
            }
        }
        var best: Pair<Uri, JSONObject>? = null
        for (t in tries) { val r = t.await(); if (r != null) { best = r; break } }   // in order of preference; the slow ones were already running
        tries.forEach { it.cancel() }
        best
    }

    // MARK: - the network changed (Wi-Fi ↔ mobile data, airplane mode), or the app is back
    private var netCallback: ConnectivityManager.NetworkCallback? = null
    private var lastNetwork: Network? = null
    private fun watchNetwork() {
        val cm = getSystemService(ConnectivityManager::class.java) ?: return
        val cb = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) { runOnUiThread { if (lastNetwork != null && lastNetwork != network) networkChanged(); lastNetwork = network } }
            override fun onLost(network: Network) { runOnUiThread { if (lastNetwork == network) { lastNetwork = null; networkChanged() } } }
        }
        runCatching { cm.registerDefaultNetworkCallback(cb); netCallback = cb }
    }
    override fun onDestroy() {
        netCallback?.let { cb -> runCatching { getSystemService(ConnectivityManager::class.java)?.unregisterNetworkCallback(cb) } }
        netCallback = null
        super.onDestroy()
    }
    private fun networkChanged() {
        if (!::web.isInitialized) return
        // the page hears it at once: the app's own screens try again; your home drops the requests and the live stream
        // left on the old connection (dead, but nothing says so) and asks again on the new one
        web.evaluateJavascript("window.__casaEvent && window.__casaEvent('network', ${Net.json(this)}); 1", null)
        if (onShell) return
        recheckHome(1500, rerace = true)   // let the new connection settle
    }
    /**
     * A home is on screen: still answering at this address? If not, the best address that does (from anywhere instead
     * of the home Wi-Fi, say), on the same page. If none does, "can't reach", which keeps trying by itself.
     * After a network change ([rerace]) the addresses are raced again even when this one still answers: back on the
     * home Wi-Fi, the home address (much faster than going out and back in through secure access) takes over.
     */
    private fun recheckHome(delayMs: Long, rerace: Boolean = false) {
        if (lockView.visibility == View.VISIBLE || onShell) return
        val cur = web.url?.let(Uri::parse) ?: return
        val id = currentHomeId() ?: return
        val home = HomeStore.home(id) ?: return
        val here = Home.originOf(cur)
        recheckJob?.cancel()
        recheckJob = lifecycleScope.launch {
            delay(delayMs)
            val hereOk = firstAnswering(listOf(Uri.parse(here)), 3000) != null
            if (hereOk && !rerace) return@launch   // still fine where it is
            val order = if (rerace) home.raceOrder else home.candidates
            var found = firstAnswering(order)
            if (found == null && !hereOk) { delay(3000); found = firstAnswering(order) }
            val now = web.url?.let(Uri::parse) ?: return@launch
            if (Home.originOf(now) != here) return@launch   // you moved on meanwhile
            if (found == null) { if (!hereOk) openShell("unreachable=$id"); return@launch }
            val base = Home.originOf(found.first)
            if (base == here) return@launch
            HomeStore.learn(id, found.second)
            HomeStore.touch(id, found.first)
            tokenCache[id]?.let { setSessionCookie(it, HomeStore.home(id) ?: home, found.first) }
            val tail = (now.encodedPath?.takeIf { it.isNotEmpty() } ?: "/") + (now.encodedQuery?.let { "?$it" } ?: "") + (now.encodedFragment?.let { "#$it" } ?: "")
            web.loadUrl(base + tail)
        }
    }

    /**
     * The sign-in, as the cookie your CasaTorch expects. [at] is the address the home is (being) opened at. Open at an
     * https address (the secure one at home, or from anywhere): only the https addresses get it, marked Secure, and a copy
     * left on a plain-http address is taken back - so it's never sent unencrypted while an encrypted address answers.
     * Open at its plain address (no https address answered): every address gets it, as before. Not known: as before too.
     */
    fun setSessionCookie(token: String, home: Home, at: Uri? = null) {
        val cm = CookieManager.getInstance()
        val open = at ?: web.url?.takeUnless { it.startsWith(SHELL_ORIGIN) }?.let(Uri::parse) ?: home.here?.let(Uri::parse)
        val (secure, plain) = home.candidates.partition { it.scheme == "https" }
        val plainHosts = plain.mapNotNull { it.host?.lowercase() }.toSet()
        if (open != null && open.scheme == "https") {
            val secureHosts = secure.mapNotNull { it.host?.lowercase() }.toSet()
            for (u in plain) if (u.host?.lowercase() !in secureHosts) cm.setCookie(Home.originOf(u), "casatorch_session=; Path=/; Max-Age=0")
            for (u in secure) cm.setCookie(Home.originOf(u), "casatorch_session=$token; Path=/; HttpOnly; SameSite=Lax; Secure")
        } else {
            for (u in secure) {
                val shared = u.host?.lowercase() in plainHosts   // the same name over http too: a Secure cookie there would block it
                if (shared) cm.setCookie(Home.originOf(u), "casatorch_session=; Path=/; Max-Age=0; Secure")
                cm.setCookie(Home.originOf(u), "casatorch_session=$token; Path=/; HttpOnly; SameSite=Lax" + if (shared) "" else "; Secure")
            }
            for (u in plain) cm.setCookie(Home.originOf(u), "casatorch_session=$token; Path=/; HttpOnly; SameSite=Lax")
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
        if (!Home.allowed(u)) return false   // plain http only on the home network
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
            if (!req.isForMainFrame || Home.originOf(req.url) == SHELL_ORIGIN) return
            reveal()
            (openingHome?.id ?: currentHomeId())?.let { openShell("unreachable=$it") }
        }
        override fun onPageFinished(view: WebView, url: String?) {
            swipe.isRefreshing = false
            reveal()
            if (clearHistoryOnLoad && url != null && !url.startsWith(SHELL_ORIGIN)) { clearHistoryOnLoad = false; view.clearHistory() }
            matchPageColor()
            // older WebViews without document-start scripts: the bridge goes in as soon as the page is there
            if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT) && url != null && isTrustedOrigin(Home.originOf(Uri.parse(url))))
                view.evaluateJavascript("window.__casaInfo = ${bridge.infoJson()};\n$bridgeJs", null)
        }
        /** The page's process stopped (memory pressure, a crash): a fresh web view in its place, same page - never a blank screen. */
        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            if (view !== web) { view.destroy(); return true }
            openJob?.cancel(); recheckJob?.cancel()
            val last = view.url
            swipe.removeView(view); view.destroy()
            web = buildWeb()
            swipe.addView(web, 0, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            attachWeb()
            when {
                last == null -> start()
                last.startsWith(SHELL_ORIGIN) -> web.loadUrl(last)
                else -> currentHomeIdFor(last)?.let { id -> HomeStore.home(id)?.let { h -> tokenCache[id]?.let { setSessionCookie(it, h, Uri.parse(last)) } }; web.loadUrl(last) } ?: start()
            }
            return true
        }
    }
    private fun currentHomeIdFor(url: String): String? { val host = Uri.parse(url).host?.lowercase() ?: return null; return HomeStore.homes.firstOrNull { host in it.hosts }?.id }

    private inner class Chrome : WebChromeClient() {
        override fun onShowFileChooser(view: WebView, cb: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
            fileCallback?.onReceiveValue(null); fileCallback = cb
            return runCatching { pickFiles.launch(params.createIntent()); true }.getOrElse { fileCallback = null; false }
        }
        // the dashboard never needs the camera or microphone inside the page
        override fun onPermissionRequest(request: PermissionRequest) { request.deny() }
        override fun onJsAlert(view: WebView, url: String?, message: String?, result: JsResult): Boolean {
            if (isFinishing) { result.cancel(); return true }
            AlertDialog.Builder(this@MainActivity).setMessage(message).setPositiveButton(android.R.string.ok) { _, _ -> result.confirm() }.setOnCancelListener { result.cancel() }.show(); return true
        }
        override fun onJsConfirm(view: WebView, url: String?, message: String?, result: JsResult): Boolean {
            if (isFinishing) { result.cancel(); return true }
            AlertDialog.Builder(this@MainActivity).setMessage(message).setPositiveButton(android.R.string.ok) { _, _ -> result.confirm() }.setNegativeButton(android.R.string.cancel) { _, _ -> result.cancel() }.setOnCancelListener { result.cancel() }.show(); return true
        }
        override fun onJsPrompt(view: WebView, url: String?, message: String?, def: String?, result: JsPromptResult): Boolean {
            if (isFinishing) { result.cancel(); return true }
            val input = EditText(this@MainActivity).apply { setText(def) }
            AlertDialog.Builder(this@MainActivity).setMessage(message).setView(input).setPositiveButton(android.R.string.ok) { _, _ -> result.confirm(input.text.toString()) }.setNegativeButton(android.R.string.cancel) { _, _ -> result.cancel() }.setOnCancelListener { result.cancel() }.show(); return true
        }
    }

    // MARK: - links from outside: a pairing QR scanned with the camera app, an alert tapped
    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); handleIntent(intent) }
    private fun handleIntent(i: Intent?) {
        i ?: return
        i.data?.let { if (it.scheme == "casatorch") { handlePairLink(it); i.data = null } }
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
            .apply { if (Build.VERSION.SDK_INT < 30) setNegativeButtonText(getString(R.string.cancel)) }.build()
        prompt.authenticate(info)
    }

    private fun unlock() {
        if (unlocking) return
        unlocking = true
        lifecycleScope.launch {
            val ok = authenticate(getString(R.string.unlock_title))
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
        lockView.announceForAccessibility(getString(R.string.locked))
        dropSessionCookies()
    }
    /** With the lock on, the app's content is hidden from the recent-apps screen (and from screenshots below Android 13). */
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
        if (!::lockView.isInitialized || backgroundedAt == 0L) return
        val away = SystemClock.elapsedRealtime() - backgroundedAt
        web.evaluateJavascript("window.__casaEvent && window.__casaEvent('resume', {}); 1", null)
        if (lockView.visibility != View.VISIBLE) { if (away > 20_000) recheckHome(300); return }
        if (unlocking && away > 2000) unlocking = false   // a prompt that never showed
        if (unlocking) return
        if (away < RELOCK_AFTER_MS) {
            // back within two minutes: no prompt, the sign-in comes back from memory
            val id = currentHomeId(); val t = id?.let { tokenCache[it] }; val h = id?.let { HomeStore.home(it) }
            if (t != null && h != null) {
                setSessionCookie(t, h, web.url?.takeUnless { it.startsWith(SHELL_ORIGIN) }?.let(Uri::parse)); lockView.visibility = View.GONE
                pendingAlert?.let { (p, hid) -> pendingAlert = null; openAlert(p, hid) }
                if (away > 20_000) recheckHome(300)
                return
            }
        }
        tokenCache.clear(); unlock()
    }

    private fun buildLockView(): View = FrameLayout(this).apply {
        setBackgroundColor(getColor(R.color.launch_bg)); visibility = View.GONE; isClickable = true; isFocusable = true
        val col = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL }
        col.addView(ImageView(context).apply { setImageResource(R.drawable.ic_launcher_foreground); importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO }, LinearLayout.LayoutParams(dp(120), dp(120)))
        col.addView(TextView(context).apply {
            setText(R.string.locked); setTextColor(Color.WHITE); textSize = 22f; gravity = Gravity.CENTER; setPadding(dp(24), dp(8), dp(24), dp(24))
            ViewCompat.setAccessibilityHeading(this, true)
        })
        col.addView(Button(context).apply {
            setText(R.string.unlock); isAllCaps = false; textSize = 17f; setTextColor(Color.parseColor("#05121C")); minHeight = dp(48)
            background = android.graphics.drawable.GradientDrawable().apply { cornerRadius = dp(14).toFloat(); setColor(getColor(R.color.accent)) }
            setPadding(dp(36), dp(14), dp(36), dp(14)); setOnClickListener { unlock() }
        })
        addView(col, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER))
    }
    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()
}
