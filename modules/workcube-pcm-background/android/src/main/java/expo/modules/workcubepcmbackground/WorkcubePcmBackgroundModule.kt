package expo.modules.workcubepcmbackground

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import expo.modules.audio.AudioStream
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.withTimeout
import java.util.UUID

class WorkcubePcmBackgroundModule : Module() {
  private val owner = UUID.randomUUID().toString()
  override fun definition() = ModuleDefinition {
    Name("WorkcubePcmBackground")
    Events("onCaptureStopped")
    Function("isAvailable") { appContext.reactContext != null }
    Function("lifecycleVersion") { 1 }
    Function("prepare") { stream: AudioStream ->
      val context = appContext.reactContext ?: throw IllegalStateException("Uygulama hazır değil.")
      WorkcubePcmForegroundService.checkNotification(context)
      val lease = captureRegistry.register(object : PcmCaptureRegistry.Capture {
        override val key = stream.id
        override fun start() = stream.start()
        override fun stop() = stream.stop()
      }, owner) { id, reason -> sendEvent("onCaptureStopped", mapOf("id" to id, "reason" to reason, "streamId" to stream.id)) }
      lease.id
    }
    AsyncFunction("start") Coroutine { id: String ->
      val context = appContext.reactContext ?: throw IllegalStateException("Uygulama hazır değil.")
      try {
        val lease = captureRegistry.launch(id) {
          ContextCompat.startForegroundService(context, Intent(context, WorkcubePcmForegroundService::class.java)
            .putExtra("captureId", id))
        }
        withTimeout(10000) { lease.ready.await() }
        check(captureRegistry.active(lease.id)) { "Kayıt bildirimi kapandı." }
      } catch (error: Exception) {
        captureRegistry.release(id)
        WorkcubePcmForegroundService.dismiss(id)
        throw error
      }
    }
    AsyncFunction("startCapture") Coroutine { id: String ->
      val context = appContext.reactContext ?: throw IllegalStateException("Uygulama hazır değil.")
      check(ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
        "Mikrofon izni gerekiyor."
      }
      WorkcubePcmForegroundService.checkNotification(context)
      captureRegistry.start(id)
    }
    Function("captureState") { stream: AudioStream -> captureRegistry.state(stream.id) }
    Function("release") { id: String ->
      captureRegistry.release(id)
      WorkcubePcmForegroundService.dismiss(id)
    }
    Function("stop") {
      captureRegistry.releaseOwner(owner)?.let { WorkcubePcmForegroundService.dismiss(it) }
    }
    OnDestroy {
      captureRegistry.releaseOwner(owner)?.let { WorkcubePcmForegroundService.dismiss(it) }
    }
  }
  companion object { internal val captureRegistry = PcmCaptureRegistry() }
}
