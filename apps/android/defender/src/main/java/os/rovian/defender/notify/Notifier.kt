package os.rovian.defender.notify

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import os.rovian.defender.DefenderActivity
import os.rovian.defender.R
import os.rovian.defender.core.DefenderCore
import os.rovian.defender.core.EventStore
import java.util.concurrent.TimeUnit

/**
 * Notifications only for what matters: a new high-severity finding (a dangerous app, a critical setting). Nothing
 * for routine scans, and at most one notification per scan.
 */
object Notifier {
    private const val CHANNEL = "security-alerts"

    fun ensureChannel(ctx: Context) {
        if (Build.VERSION.SDK_INT >= 26) {
            val nm = ctx.getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "Security alerts", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Dangerous apps, files and critical device settings Rovian Defender finds."
            })
        }
    }

    fun canNotify(ctx: Context) = Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    fun alert(ctx: Context, items: List<String>) {
        if (items.isEmpty() || !canNotify(ctx)) return
        ensureChannel(ctx)
        val open = PendingIntent.getActivity(ctx, 0, Intent(ctx, DefenderActivity::class.java).putExtra("tab", "activity").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val n = NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_shield)
            .setContentTitle(if (items.size == 1) items.first() else "Rovian Defender found ${items.size} serious issues")
            .setContentText(if (items.size == 1) "Tap to see what Rovian Defender found and what to do." else items.take(3).joinToString(" · "))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_RECOMMENDATION)
            .setContentIntent(open)
            .setAutoCancel(true)
            .build()
        try { NotificationManagerCompat.from(ctx).notify(1001, n) } catch (e: SecurityException) { /* permission revoked */ }
    }

    /** A daily check of your apps and settings, on Android's own scheduler (battery-friendly, survives restarts). */
    fun scheduleDaily(ctx: Context) {
        val req = PeriodicWorkRequestBuilder<DailyScan>(1, TimeUnit.DAYS).build()
        WorkManager.getInstance(ctx).enqueueUniquePeriodicWork("daily-scan", ExistingPeriodicWorkPolicy.KEEP, req)
    }
}

class DailyScan(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        val r = withContext(Dispatchers.IO) { DefenderCore.scan(applicationContext) }
        val fresh = withContext(Dispatchers.Main) { DefenderCore.record(EventStore(applicationContext), r) }
        Notifier.alert(applicationContext, fresh)
        return Result.success()
    }
}
