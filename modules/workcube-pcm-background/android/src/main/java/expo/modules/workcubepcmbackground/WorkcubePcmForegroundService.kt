package expo.modules.workcubepcmbackground

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.os.Handler
import android.os.Looper
import java.lang.ref.WeakReference
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/** The notification owns the actual PCM stream; stop never waits for JavaScript. */
class WorkcubePcmForegroundService : Service() {
  private var ownedId: String? = null
  private var ownedStartId: Int = 0
  override fun onCreate() { super.onCreate(); instance = WeakReference(this) }
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    ownedStartId = startId
    val id = intent?.getStringExtra("captureId") ?: return START_NOT_STICKY
    if (!registry.active(id)) {
      if (!registry.hasActive()) stopSelf(startId)
      return START_NOT_STICKY
    }
    if (intent.action == STOP_ACTION) {
      registry.stop(id, "notification-stop")
      stopSelf(startId)
      return START_NOT_STICKY
    }
    ownedId = id
    try {
      checkNotification(this)
      // Data participates in PendingIntent identity; old actions cannot stop new captures.
      val stopIntent = Intent(this, WorkcubePcmForegroundService::class.java).setAction(STOP_ACTION)
        .setData(Uri.parse("workcube-pcm://stop/$id")).putExtra("captureId", id)
      val stop = PendingIntent.getService(this, 0, stopIntent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
      val notification = NotificationCompat.Builder(this, CHANNEL_ID)
        .setSmallIcon(android.R.drawable.ic_btn_speak_now)
        .setContentTitle("Workcube Meeting")
        .setContentText("Toplantı ses kaydı sürüyor")
        .setOngoing(true)
        .setCategory(NotificationCompat.CATEGORY_SERVICE)
        .addAction(android.R.drawable.ic_media_pause, "Kaydı durdur", stop)
      packageManager.getLaunchIntentForPackage(packageName)?.let {
        notification.setContentIntent(PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        startForeground(NOTIFICATION_ID, notification.build(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
      } else { startForeground(NOTIFICATION_ID, notification.build()) }
      registry.ready(id)
    } catch (_: Exception) {
      registry.stop(id, "notification-failed")
      stopSelf(startId)
    }
    return START_NOT_STICKY
  }

  override fun onTaskRemoved(rootIntent: Intent?) {
    ownedId?.let { registry.stop(it, "task-removed") }
    stopSelf()
    super.onTaskRemoved(rootIntent)
  }

  override fun onDestroy() {
    ownedId?.let { registry.stop(it, "service-destroyed") }
    stopForeground(STOP_FOREGROUND_REMOVE)
    if (instance?.get() === this) instance = null
    super.onDestroy()
  }

  companion object {
    private var instance: WeakReference<WorkcubePcmForegroundService>? = null
    internal fun dismiss(id: String) {
      Handler(Looper.getMainLooper()).post {
        registry.whenIdle {
          instance?.get()?.takeIf { it.ownedId == id }?.let { it.stopSelfResult(it.ownedStartId) }
        }
      }
    }
    private val registry get() = WorkcubePcmBackgroundModule.captureRegistry
    private const val STOP_ACTION = "com.workcube.meeting.STOP_PCM"
    private const val CHANNEL_ID = "workcube_meeting_recording"
    private const val NOTIFICATION_ID = 7314
    internal fun checkNotification(context: Context) {
      check(NotificationManagerCompat.from(context).areNotificationsEnabled()) { "Kayıt bildirimi iznini açın." }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(CHANNEL_ID, "Toplantı ses kaydı", NotificationManager.IMPORTANCE_LOW))
        check(manager.getNotificationChannel(CHANNEL_ID)?.importance != NotificationManager.IMPORTANCE_NONE) {
          "Toplantı ses kaydı bildirim kanalını Ayarlar’dan açın."
        }
      }
    }
  }
}
