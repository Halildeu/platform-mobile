package expo.modules.workcubepcmbackground

import java.util.UUID
import kotlinx.coroutines.CompletableDeferred

/** One registration owns both the service and microphone, including startup. */
internal class PcmCaptureRegistry {
  interface Capture {
    val key: String
    fun start()
    fun stop()
  }
  class Lease(val capture: Capture, val owner: String, val onStop: (String, String) -> Unit) {
    val id: String = UUID.randomUUID().toString()
    val ready = CompletableDeferred<Unit>()
    var reason: String? = null
  }
  private var current: Lease? = null

  @Synchronized fun register(capture: Capture, owner: String = "test", onStop: (String, String) -> Unit): Lease {
    check(current == null) { "Önceki kayıt kapatılmalı." }
    return Lease(capture, owner, onStop).also { current = it }
  }
  @Synchronized fun active(id: String): Boolean = current?.let { it.id == id && it.reason == null } == true
  @Synchronized fun ready(id: String) {
    current?.takeIf { it.id == id && it.reason == null }?.ready?.complete(Unit)
  }
  @Synchronized fun start(id: String) {
    val lease = current
    check(lease != null && lease.id == id && lease.reason == null && lease.ready.isCompleted) {
      "Kayıt bildirimi kapandı; mikrofon başlatılmadı."
    }
    lease.capture.start()
  }
  @Synchronized fun launch(id: String, work: () -> Unit): Lease {
    val lease = current
    check(lease != null && lease.id == id && lease.reason == null) { "Kayıt kapandı." }
    work()
    return lease
  }
  @Synchronized fun hasActive(): Boolean = current?.reason == null && current != null
  @Synchronized fun whenIdle(work: () -> Unit) { if (!hasActive()) work() }
  @Synchronized fun state(key: String): Map<String, String>? = current?.takeIf { it.capture.key == key }
    ?.let { mapOf("id" to it.id, "reason" to (it.reason ?: "")) }

  @Synchronized fun stop(id: String, reason: String) {
    val lease = current?.takeIf { it.id == id && it.reason == null } ?: return
    // AudioStream emits a separate status event; the reason must already exist.
    lease.reason = reason
    lease.ready.completeExceptionally(IllegalStateException("Kayıt durduruldu."))
    try { lease.capture.stop() }
    catch (_: Exception) { lease.reason = "stop-failed" }
    finally { try { lease.onStop(lease.id, lease.reason!!) } catch (_: Exception) { /* JS may already be destroyed. */ } }
  }
  @Synchronized fun release(id: String) {
    if (current?.id != id) return
    stop(id, "requested")
    current = null
  }
  @Synchronized fun releaseOwner(owner: String): String? {
    val id = current?.takeIf { it.owner == owner }?.id ?: return null
    release(id)
    return id
  }
}
