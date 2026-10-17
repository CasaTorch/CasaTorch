package com.casatorch.app

import android.content.Context
import android.content.SharedPreferences
import android.net.Uri
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.security.keystore.UserNotAuthenticatedException
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.security.KeyStore
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/** A home this phone is signed in to: just your own CasaTorch, no account anywhere else. */
data class Home(
    val id: String,
    val name: String,
    val userName: String?,
    val userRole: String?,
    val lan: String?,
    val remote: String?,
    val plain: String?,
    var here: String?,
    var last: Long,
) {
    /** The address that worked last time first, then the secure one at home, then from anywhere, then plain. */
    val candidates: List<Uri>
        get() = listOfNotNull(here, lan, remote, plain).distinct().map(Uri::parse).filter { (it.scheme == "https" || it.scheme == "http") && !it.host.isNullOrEmpty() }
    val hosts: Set<String> get() = candidates.mapNotNull { it.host?.lowercase() }.toSet()
    val origins: Set<String> get() = candidates.map(::originOf).toSet()

    fun toJson(): JSONObject = JSONObject().apply {
        put("id", id); put("name", name)
        put("user", JSONObject().put("name", userName ?: "").put("role", userRole ?: ""))
        put("addresses", JSONObject().apply { put("lan", lan ?: JSONObject.NULL); put("remote", remote ?: JSONObject.NULL); put("plain", plain ?: JSONObject.NULL); put("here", here ?: JSONObject.NULL) })
        put("last", last)
    }

    companion object {
        /** scheme://host[:port], the way the web view reports a page's origin (no default port). */
        fun originOf(u: Uri): String {
            val dflt = (u.scheme == "https" && u.port == 443) || (u.scheme == "http" && u.port == 80)
            return "${u.scheme}://${u.host?.lowercase()}${if (u.port > 0 && !dflt) ":${u.port}" else ""}"
        }
        fun fromJson(o: JSONObject): Home {
            val u = o.optJSONObject("user") ?: JSONObject()
            val a = o.optJSONObject("addresses") ?: JSONObject()
            fun str(j: JSONObject, k: String) = if (j.isNull(k)) null else j.optString(k).takeIf { it.isNotEmpty() }
            return Home(o.getString("id"), o.optString("name", "Home"), str(u, "name"), str(u, "role"), str(a, "lan"), str(a, "remote"), str(a, "plain"), str(a, "here"), o.optLong("last"))
        }
    }
}

/** Thrown when the Face ID-style lock is on and the phone hasn't been unlocked in the last few seconds. */
class NeedsUnlock : Exception("Unlock CasaTorch first.")

/**
 * The phone's sign-ins and alert keys, sealed with keys that live in the Android Keystore (hardware-backed on
 * nearly every phone, and never readable by the app itself). With the lock on, sign-ins are sealed with a second
 * key that only opens for a few seconds after your fingerprint, face or screen lock. Alert keys use the first key,
 * so alerts can be opened while the phone is locked in your pocket - they're useless anywhere else.
 */
object Vault {
    private const val OPEN = "casatorch.vault"
    private const val LOCKED = "casatorch.vault.locked"
    private val ks: KeyStore by lazy { KeyStore.getInstance("AndroidKeyStore").apply { load(null) } }

    private fun key(locked: Boolean): SecretKey {
        val alias = if (locked) LOCKED else OPEN
        (ks.getKey(alias, null) as? SecretKey)?.let { return it }
        val spec = KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setRandomizedEncryptionRequired(true)
            .apply {
                if (locked) {
                    setUserAuthenticationRequired(true)
                    if (Build.VERSION.SDK_INT >= 30) setUserAuthenticationParameters(30, KeyProperties.AUTH_BIOMETRIC_STRONG or KeyProperties.AUTH_DEVICE_CREDENTIAL)
                    else @Suppress("DEPRECATION") setUserAuthenticationValidityDurationSeconds(30)
                }
            }.build()
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run { init(spec); generateKey() }
    }

    fun seal(data: ByteArray, locked: Boolean): String {
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        try { c.init(Cipher.ENCRYPT_MODE, key(locked)) }
        catch (e: UserNotAuthenticatedException) { throw NeedsUnlock() }
        catch (e: KeyPermanentlyInvalidatedException) { drop(locked); c.init(Cipher.ENCRYPT_MODE, key(locked)) }   // the screen lock was removed: a fresh key
        return Base64.encodeToString(c.iv + c.doFinal(data), Base64.NO_WRAP)
    }

    fun open(sealed: String, locked: Boolean): ByteArray? {
        val all = try { Base64.decode(sealed, Base64.NO_WRAP) } catch (_: IllegalArgumentException) { return null }
        if (all.size < 12 + 16) return null
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        return try {
            c.init(Cipher.DECRYPT_MODE, key(locked), GCMParameterSpec(128, all, 0, 12))
            c.doFinal(all, 12, all.size - 12)
        } catch (e: UserNotAuthenticatedException) { throw NeedsUnlock() } catch (_: KeyPermanentlyInvalidatedException) { drop(locked); null } catch (_: Exception) { null }
    }

    private fun drop(locked: Boolean) { runCatching { ks.deleteEntry(if (locked) LOCKED else OPEN) } }
    fun forgetLockedKey() = drop(true)
}

object HomeStore {
    private lateinit var prefs: SharedPreferences
    private val list = mutableListOf<Home>()
    fun init(ctx: Context) {
        if (::prefs.isInitialized) return
        prefs = ctx.getSharedPreferences("casatorch", Context.MODE_PRIVATE)
        runCatching { val a = JSONArray(prefs.getString("homes", "[]")); for (i in 0 until a.length()) list.add(Home.fromJson(a.getJSONObject(i))) }
    }
    private fun save() { prefs.edit().putString("homes", JSONArray(list.map { it.toJson() }).toString()).apply() }

    val homes: List<Home> get() = list.toList()
    var currentId: String?
        get() = prefs.getString("current", null)
        set(v) { prefs.edit().putString("current", v).apply() }
    val current: Home? get() = list.firstOrNull { it.id == currentId } ?: list.firstOrNull()
    fun home(id: String) = list.firstOrNull { it.id == id }
    val origins: Set<String> get() = list.flatMap { it.origins }.toSet()

    var biometricLock: Boolean
        get() = prefs.getBoolean("lock", false)
        private set(v) { prefs.edit().putBoolean("lock", v).apply() }

    fun upsert(h: Home, token: String): Boolean {
        val sealed = try { Vault.seal(token.toByteArray(), biometricLock) } catch (e: NeedsUnlock) { throw e } catch (_: Exception) { return false }
        list.removeAll { it.id == h.id }; list.add(h)
        prefs.edit().putString("token.${h.id}", sealed).apply()
        currentId = h.id; save()
        return true
    }
    fun touch(id: String, working: Uri?) {
        val h = home(id) ?: return
        h.last = System.currentTimeMillis()
        if (working != null) h.here = Home.originOf(working)
        currentId = id; save()
    }
    fun remove(id: String) {
        list.removeAll { it.id == id }
        prefs.edit().remove("token.$id").remove("alertkey.$id").remove("pushtoken.$id").apply()
        if (currentId == id) currentId = list.firstOrNull()?.id
        save()
    }
    /** The sign-in for a home. Throws [NeedsUnlock] when the lock is on and it's been more than a few seconds. */
    fun token(id: String): String? = prefs.getString("token.$id", null)?.let { Vault.open(it, biometricLock) }?.let { String(it) }
    fun dropToken(id: String) { prefs.edit().remove("token.$id").apply() }

    /** Turning the lock on or off re-seals every sign-in with (or without) it. Call right after the person unlocked. */
    /** The phone's screen lock was removed: the lock can't work, so it goes off (sign-ins sealed with it are gone too). */
    fun lockLost() { prefs.edit().putBoolean("lock", false).apply(); Vault.forgetLockedKey() }

    fun setLock(on: Boolean): Boolean {
        if (on == biometricLock) return true
        val plain = list.associate { it.id to runCatching { token(it.id) }.getOrNull() }
        val sealed = try { plain.mapValues { (_, t) -> t?.let { Vault.seal(it.toByteArray(), on) } } } catch (_: Exception) { return false }
        val e = prefs.edit()
        sealed.forEach { (id, s) -> if (s != null) e.putString("token.$id", s) }
        e.putBoolean("lock", on).apply()
        if (!on) Vault.forgetLockedKey()
        return true
    }

    /** Each home's alert key: made on this phone, given only to that home. */
    fun alertKey(id: String): ByteArray {
        prefs.getString("alertkey.$id", null)?.let { Vault.open(it, false) }?.takeIf { it.size == 32 }?.let { return it }
        val k = ByteArray(32).also { SecureRandom().nextBytes(it) }
        prefs.edit().putString("alertkey.$id", Vault.seal(k, false)).apply()
        return k
    }
    fun alertKeys(): List<Pair<String, SecretKeySpec>> = list.mapNotNull { h ->
        prefs.getString("alertkey.${h.id}", null)?.let { Vault.open(it, false) }?.takeIf { it.size == 32 }?.let { h.id to SecretKeySpec(it, "AES") }
    }

    /** The push address this phone gave each home, so a new one can be passed on when Google changes it. */
    fun pushToken(id: String): String? = prefs.getString("pushtoken.$id", null)
    fun setPushToken(id: String, t: String) { prefs.edit().putString("pushtoken.$id", t).apply() }
}
