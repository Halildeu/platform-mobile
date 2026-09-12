package expo.modules.workcubepcmbackground

import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class WorkcubePcmBackgroundModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("WorkcubePcmBackground")

    Function("isAvailable") {
      appContext.reactContext != null
    }

    AsyncFunction("start") {
      val context = appContext.reactContext
        ?: throw IllegalStateException("Android uygulama bağlamı hazır değil")
      ContextCompat.startForegroundService(context, Intent(context, WorkcubePcmForegroundService::class.java))
    }

    Function("stop") {
      appContext.reactContext?.stopService(Intent(appContext.reactContext, WorkcubePcmForegroundService::class.java))
    }
  }
}
