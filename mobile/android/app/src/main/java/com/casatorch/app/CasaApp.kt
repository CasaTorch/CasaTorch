package com.casatorch.app

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import com.google.firebase.FirebaseApp

class CasaApp : Application() {
    override fun onCreate() {
        super.onCreate()
        HomeStore.init(this)
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CH_ALERTS, getString(R.string.ch_alerts), NotificationManager.IMPORTANCE_HIGH).apply { description = getString(R.string.ch_alerts_desc) })
        nm.createNotificationChannel(NotificationChannel(CH_URGENT, getString(R.string.ch_urgent), NotificationManager.IMPORTANCE_HIGH).apply {
            description = getString(R.string.ch_urgent_desc); enableVibration(true); vibrationPattern = longArrayOf(0, 400, 200, 400, 200, 700); setBypassDnd(true)
        })
    }
    companion object {
        const val CH_ALERTS = "alerts"
        const val CH_URGENT = "urgent"
        /** Alerts need google-services.json in the build (see mobile/README.md); without it they're switched off. */
        fun pushConfigured(ctx: Context) = FirebaseApp.getApps(ctx).isNotEmpty()
    }
}
