package expo.modules.workcubepcmbackground

import org.junit.Assert.*
import org.junit.Test

class PcmCaptureRegistryTest {
  private class FakeCapture(override val key: String = "stream") : PcmCaptureRegistry.Capture {
    var starts = 0
    var stops = 0
    var onStop: () -> Unit = {}
    override fun start() { starts++ }
    override fun stop() { stops++; onStop() }
  }

  @Test fun stoppingBeforeServiceReadyPreventsLateMicrophoneStart() {
    val registry = PcmCaptureRegistry(); val capture = FakeCapture()
    val lease = registry.register(capture) { _, _ -> }
    registry.stop(lease.id, "notification-stop")
    registry.ready(lease.id)
    assertThrows(IllegalStateException::class.java) { registry.start(lease.id) }
    assertEquals(0, capture.starts)
    assertTrue(lease.ready.isCancelled)
  }
  @Test fun notificationDirectlyStopsCaptureAndReasonPrecedesNativeStatus() {
    val registry = PcmCaptureRegistry(); val capture = FakeCapture()
    var callbacks = 0
    val lease = registry.register(capture) { _, reason -> callbacks++; assertEquals("notification-stop", reason) }
    registry.ready(lease.id); registry.start(lease.id)
    capture.onStop = { assertEquals("notification-stop", registry.state(capture.key)?.get("reason")) }
    registry.stop(lease.id, "notification-stop")
    registry.stop(lease.id, "service-destroyed")
    assertEquals(1, capture.starts); assertEquals(1, capture.stops); assertEquals(1, callbacks)
  }
  @Test fun staleNotificationOrServiceTeardownCannotStopNextRecording() {
    val registry = PcmCaptureRegistry(); val first = FakeCapture()
    val old = registry.register(first) { _, _ -> }
    registry.release(old.id)
    val second = FakeCapture(); val current = registry.register(second) { _, _ -> }
    registry.ready(current.id); registry.start(current.id)
    registry.stop(old.id, "notification-stop"); registry.release(old.id)
    assertTrue(registry.active(current.id)); assertEquals(0, second.stops)
    assertNotEquals(old.id, current.id)
  }
  @Test fun failedMicrophoneStopDoesNotClaimSuccessfulUserStop() {
    val registry = PcmCaptureRegistry(); val capture = FakeCapture()
    val lease = registry.register(capture) { _, reason -> assertEquals("stop-failed", reason) }
    capture.onStop = { throw IllegalStateException("hardware failure") }
    registry.stop(lease.id, "notification-stop")
    assertEquals("stop-failed", registry.state(capture.key)?.get("reason"))
  }
  @Test fun microphoneCannotStartBeforeVisibleServiceOrFromAnotherStream() {
    val registry = PcmCaptureRegistry(); val capture = FakeCapture()
    val lease = registry.register(capture) { _, _ -> }
    assertThrows(IllegalStateException::class.java) { registry.start(lease.id) }
    registry.ready(lease.id)
    assertThrows(IllegalStateException::class.java) { registry.start("other") }
    assertEquals(0, capture.starts)
  }
}
