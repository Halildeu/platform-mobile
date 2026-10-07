package expo.modules.audio.service

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.os.Handler
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import expo.modules.audio.AudioStream

/** PCM stream lifecycle only. No audio files, network calls, tokens or meeting titles. */
class PcmCaptureService : Service() {
  private var wakeLock: PowerManager.WakeLock? = null
  private val handler = Handler(Looper.getMainLooper())
  private val deadline = Runnable { stopCapture() }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == STOP || activeStream == null) {
      stopCapture()
      return START_NOT_STICKY
    }
    try {
      val manager = getSystemService(NotificationManager::class.java)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        manager.createNotificationChannel(NotificationChannel(CHANNEL, "Toplantı ses kaydı", NotificationManager.IMPORTANCE_LOW))
      }
      val stopIntent = PendingIntent.getService(this, 7314,
        Intent(this, PcmCaptureService::class.java).setAction(STOP),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
      val notification = NotificationCompat.Builder(this, CHANNEL)
        .setSmallIcon(android.R.drawable.ic_btn_speak_now)
        .setContentTitle("Mikrofon açık")
        .setContentText("Toplantı sesi sunucuya gönderiliyor")
        .setOngoing(true).setSilent(true)
        .setDeleteIntent(stopIntent)
        .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
        .addAction(android.R.drawable.ic_media_pause, "Kaydı durdur", stopIntent)
      packageManager.getLaunchIntentForPackage(packageName)?.let {
        notification.setContentIntent(PendingIntent.getActivity(this, 7315, it,
          PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        startForeground(NOTIFICATION, notification.build(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
      } else startForeground(NOTIFICATION, notification.build())
      if (wakeLock == null) {
        wakeLock = (getSystemService(POWER_SERVICE) as PowerManager)
          .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "workcube:pcm-capture").apply { acquire(65000L) }
        // The current live-test is explicitly limited to 60 seconds, including when JS is paused.
        handler.postDelayed(deadline, 60000L)
      }
    } catch (_: Exception) {
      // A service/notification failure must stop the microphone, not leave invisible capture.
      stopCapture()
    }
    return START_NOT_STICKY
  }

  private fun stopCapture() {
    val stream = synchronized(PcmCaptureService::class.java) {
      val current = activeStream
      activeStream = null
      current
    }
    try { stream?.stop() } finally { stopSelf() }
  }

  override fun onTaskRemoved(rootIntent: Intent?) { stopCapture() }

  override fun onDestroy() {
    try { stopCapture() } finally {
      wakeLock?.let { if (it.isHeld) it.release() }
      wakeLock = null
      handler.removeCallbacks(deadline)
      synchronized(PcmCaptureService::class.java) { closing = false }
      stopForeground(STOP_FOREGROUND_REMOVE)
      super.onDestroy()
    }
  }

  companion object {
    private const val CHANNEL = "workcube_pcm_capture"
    private const val NOTIFICATION = 7314
    private const val STOP = "workcube.pcm.STOP"
    @Volatile var enabled = false
    @Volatile private var activeStream: AudioStream? = null
    @Volatile private var closing = false

    fun attach(context: Context, stream: AudioStream) {
      if (!enabled) return
      check(NotificationManagerCompat.from(context).areNotificationsEnabled()) { "Recording notification is unavailable" }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val channel = context.getSystemService(NotificationManager::class.java).getNotificationChannel(CHANNEL)
        check(channel?.importance != NotificationManager.IMPORTANCE_NONE) { "Recording notification channel is disabled" }
      }
      synchronized(PcmCaptureService::class.java) {
        check(!closing) { "Previous recording service is closing" }
        check(activeStream == null) { "Another PCM recording is active" }
        activeStream = stream
      }
      try { ContextCompat.startForegroundService(context, Intent(context, PcmCaptureService::class.java)) }
      catch (error: Exception) { synchronized(PcmCaptureService::class.java) { activeStream = null }; throw error }
    }

    fun detach(context: Context, stream: AudioStream) {
      val owned = synchronized(PcmCaptureService::class.java) {
        if (activeStream === stream) { activeStream = null; closing = true; true } else false
      }
      if (owned && !context.stopService(Intent(context, PcmCaptureService::class.java))) {
        synchronized(PcmCaptureService::class.java) { closing = false }
      }
    }
  }
}
