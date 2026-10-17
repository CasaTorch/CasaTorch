package com.casatorch.app

import android.app.PendingIntent
import android.content.Intent
import android.util.Base64
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import org.json.JSONObject
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec

/**
 * Opens a sealed alert on the phone. Your CasaTorch encrypted it (AES-256-GCM) with this phone's key for that home;
 * Google and casatorch.com only ever carried the sealed bytes. If it can't be opened, a plain notice shows instead.
 */
class PushService : FirebaseMessagingService() {
    override fun onMessageReceived(m: RemoteMessage) {
        HomeStore.init(applicationContext)
        val d = m.data
        val ct = d["ct"]?.let { runCatching { Base64.decode(it, Base64.DEFAULT) }.getOrNull() }
        val iv = d["iv"]?.let { runCatching { Base64.decode(it, Base64.DEFAULT) }.getOrNull() }
        var j: JSONObject? = null
        if (ct != null && iv != null && ct.size > 16 && iv.size == 12) {
            for ((_, key) in HomeStore.alertKeys()) {
                j = runCatching {
                    val c = Cipher.getInstance("AES/GCM/NoPadding"); c.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, iv))
                    JSONObject(String(c.doFinal(ct)))
                }.getOrNull()
                if (j != null) break
            }
        }
        val urgent = j?.optString("sev") == "critical" || d["crit"] == "1"
        val title = j?.optString("title")?.takeIf { it.isNotEmpty() } ?: "CasaTorch"
        val body = j?.optString("body") ?: "New alert from your home"
        val hid = j?.optString("hid")?.takeIf { it.isNotEmpty() }
        val url = j?.optString("url")?.takeIf { it.startsWith("/") } ?: "/#alerts"
        val tag = d["tag"]?.takeIf { it.isNotEmpty() }
        val open = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra(MainActivity.EXTRA_URL, url); putExtra(MainActivity.EXTRA_HOME, hid)
        }
        val pi = PendingIntent.getActivity(this, (tag ?: url).hashCode(), open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val n = NotificationCompat.Builder(this, if (urgent) CasaApp.CH_URGENT else CasaApp.CH_ALERTS)
            .setSmallIcon(R.drawable.ic_notify)
            .setColor(getColor(R.color.torch))
            .setContentTitle(title).setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setSubText(j?.optString("home")?.takeIf { it.isNotEmpty() })
            .setGroup(hid ?: "casatorch")
            .setCategory(if (urgent) NotificationCompat.CATEGORY_ALARM else NotificationCompat.CATEGORY_EVENT)
            .setPriority(if (urgent) NotificationCompat.PRIORITY_MAX else NotificationCompat.PRIORITY_HIGH)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(NotificationCompat.Builder(this, CasaApp.CH_ALERTS).setSmallIcon(R.drawable.ic_notify).setContentTitle("CasaTorch").setContentText("New alert from your home").build())
            .setAutoCancel(true).setContentIntent(pi)
            .build()
        val nm = NotificationManagerCompat.from(this)
        if (nm.areNotificationsEnabled()) runCatching { nm.notify(tag, if (tag != null) 1 else System.currentTimeMillis().toInt(), n) }
    }

    /** Google gave this phone a new push address: each home gets it the next time the app opens it. */
    override fun onNewToken(token: String) { getSharedPreferences("casatorch", MODE_PRIVATE).edit().putString("fcm", token).apply() }
}
