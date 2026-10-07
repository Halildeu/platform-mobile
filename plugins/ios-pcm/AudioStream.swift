// Workcube PCM lifecycle v1. Based on expo-audio 57.0.4 (see LICENSE).
import AVFoundation
import UIKit
import ExpoModulesCore

private let AUDIO_STREAM_BUFFER = "audioStreamBuffer"
private let AUDIO_STREAM_STATUS = "audioStreamStatus"

// One context per start: a stopped engine can never emit into a later recording.
private final class PcmCaptureContext {
  let id = UUID().uuidString
  let engine = AVAudioEngine()
  var converter: AVAudioConverter?
  var tapInstalled = false
  var sessionActivated = false
  var observers: [NSObjectProtocol] = []
  private let bufferLock = NSLock()
  private var accepting = false
  private var startTime: UInt64?

  func openGate() { bufferLock.lock(); accepting = true; bufferLock.unlock() }
  func closeGate() { bufferLock.lock(); accepting = false; bufferLock.unlock() }

  // No control-queue wait in the tap. Shutdown releases this lock before
  // removeTap/stop; those operations may wait for the in-flight audio callback.
  func withBuffer(_ when: AVAudioTime, _ emit: (Double) -> Void) {
    bufferLock.lock()
    defer { bufferLock.unlock() }
    guard accepting else { return }
    if startTime == nil { startTime = when.hostTime }
    let delta = when.hostTime >= startTime! ? when.hostTime - startTime! : 0
    emit(AVAudioTime.seconds(forHostTime: delta))
  }
}

class AudioStream: SharedObject {
  private static let queueKey = DispatchSpecificKey<Bool>()
  private static let controlQueue: DispatchQueue = {
    let queue = DispatchQueue(label: "com.workcube.pcm.lifecycle")
    queue.setSpecific(key: queueKey, value: true)
    return queue
  }()
  // AVAudioSession is process-wide. A second PCM stream must not deactivate
  // the first one's session, including when its own start fails.
  private static var sessionOwner: String?

  private static func controlled<T>(_ body: () throws -> T) rethrows -> T {
    if DispatchQueue.getSpecific(key: queueKey) == true { return try body() }
    return try controlQueue.sync(execute: body)
  }

  let id = UUID().uuidString
  private let requestedSampleRate: Double
  private let requestedChannels: Int
  private let encoding: AudioStreamEncoding
  private var context: PcmCaptureContext?
  private var backgroundAllowed = false
  private var streaming = false
  private var actualRate: Double = 0
  private var actualChannels = 0
  private var lastCaptureId = ""
  private var lastStopReason = ""

  var sampleRate: Double { Self.controlled { actualRate } }
  var channels: Int { Self.controlled { actualChannels } }
  var isStreaming: Bool { Self.controlled { streaming } }
  var workcubeCaptureId: String { Self.controlled { lastCaptureId } }
  var workcubeLastStopReason: String { Self.controlled { lastStopReason } }

  init(options: AudioStreamOptions) {
    requestedSampleRate = options.sampleRate
    requestedChannels = options.channels
    encoding = options.encoding
    super.init()
  }

  func configureBackgroundCapture(_ enabled: Bool) throws {
    try Self.controlled {
      guard context == nil else { throw AudioStreamException("Stop recording before changing background capture.") }
      let modes = Bundle.main.object(forInfoDictionaryKey: "UIBackgroundModes") as? [String] ?? []
      guard !enabled || modes.contains("audio") else { throw AudioStreamException("Background audio is not configured in this build.") }
      backgroundAllowed = enabled
    }
  }

  func start() throws {
    // Foreground initiation and engine startup form one main-thread operation.
    // Background notifications cannot slip between the state check and observer
    // registration. Never synchronously wait for main from the control queue.
    let startOnMain = {
      guard UIApplication.shared.applicationState == .active else {
        throw AudioStreamException("Open the app before starting microphone capture.")
      }
      try Self.controlled { try self.startControlled() }
    }
    if Thread.isMainThread { try startOnMain() }
    else { try DispatchQueue.main.sync(execute: startOnMain) }
  }

  private func startControlled() throws {
    guard context == nil else { return }
    guard Self.sessionOwner == nil else { throw AudioStreamException("Another PCM stream owns the microphone.") }
    let capture = PcmCaptureContext()
    context = capture
    lastCaptureId = capture.id
    lastStopReason = ""
    Self.sessionOwner = id
    do {
      addObservers(capture)
      let session = AVAudioSession.sharedInstance()
      try session.setCategory(.record, mode: .measurement)
      try session.setPreferredSampleRate(requestedSampleRate)
      try session.setActive(true)
      capture.sessionActivated = true
      let input = capture.engine.inputNode
      let hardware = input.outputFormat(forBus: 0)
      guard hardware.sampleRate > 0, hardware.channelCount > 0,
        requestedSampleRate.isFinite, requestedSampleRate > 0,
        requestedChannels > 0, requestedChannels <= 2 else {
        throw AudioStreamException("The microphone format is unavailable.")
      }
      let commonFormat: AVAudioCommonFormat = encoding == .int16 ? .pcmFormatInt16 : .pcmFormatFloat32
      guard let target = AVAudioFormat(commonFormat: commonFormat,
        sampleRate: requestedSampleRate, channels: AVAudioChannelCount(requestedChannels), interleaved: true) else {
        throw AudioStreamException("The requested PCM format is unsupported.")
      }
      let needsConversion = hardware.sampleRate != target.sampleRate
        || hardware.channelCount != target.channelCount
        || hardware.commonFormat != target.commonFormat
        || hardware.isInterleaved != target.isInterleaved
      if needsConversion {
        guard let converter = AVAudioConverter(from: hardware, to: target) else {
          // Never fall back to Float32 bytes advertised as PCM16.
          throw AudioStreamException("The microphone cannot convert to the requested PCM format.")
        }
        capture.converter = converter
      }
      actualRate = target.sampleRate
      actualChannels = Int(target.channelCount)
      input.installTap(onBus: 0, bufferSize: AVAudioFrameCount(hardware.sampleRate * 0.1), format: hardware) {
        [weak self, weak capture] buffer, when in
        guard let self, let capture else { return }
        capture.withBuffer(when) { timestamp in
          if let converter = capture.converter {
            self.convertAndEmit(buffer, converter: converter, target: target, timestamp: timestamp, captureId: capture.id)
          } else {
            self.emitBuffer(buffer, timestamp: timestamp, captureId: capture.id)
          }
        }
      }
      capture.tapInstalled = true
      try capture.engine.start()
      streaming = true
      capture.openGate()
      // Initial engine configuration is complete before subscribing. Later
      // changes can stop an engine without a JS event, so terminate explicitly.
      observe(capture, name: .AVAudioEngineConfigurationChange, object: capture.engine, reason: "engine-configuration-changed")
      emitStatus(reason: "started", captureId: capture.id)
    } catch {
      stopControlled(reason: "start-failed")
      throw error
    }
  }

  func stop() { Self.controlled { stopControlled(reason: "requested") } }

  private func stopControlled(reason: String, emitEvent: Bool = true) {
    guard let capture = context else { return }
    context = nil
    streaming = false
    backgroundAllowed = false
    lastStopReason = reason
    Self.releaseResources(capture, ownerId: id)
    if emitEvent { emitStatus(reason: reason, captureId: capture.id) }
  }

  private static func releaseResources(_ capture: PcmCaptureContext, ownerId: String) {
    capture.closeGate()
    capture.observers.forEach { NotificationCenter.default.removeObserver($0) }
    capture.observers.removeAll()
    if capture.tapInstalled { capture.engine.inputNode.removeTap(onBus: 0); capture.tapInstalled = false }
    capture.engine.stop()
    if sessionOwner == ownerId {
      if capture.sessionActivated {
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
      }
      sessionOwner = nil
    }
  }

  private func enqueueStop(captureId: String, reason: String) {
    // Notification delivery may hold an AVAudioEngine lock. Teardown must be
    // asynchronous, never inside that callback or while holding bufferLock.
    Self.controlQueue.async { [weak self] in
      guard let self, self.context?.id == captureId else { return }
      self.stopControlled(reason: reason)
    }
  }

  private func observe(_ capture: PcmCaptureContext, name: Notification.Name, object: Any?, reason: String) {
    let captureId = capture.id
    capture.observers.append(NotificationCenter.default.addObserver(forName: name, object: object, queue: nil) { [weak self] _ in
      self?.enqueueStop(captureId: captureId, reason: reason)
    })
  }

  private func addObservers(_ capture: PcmCaptureContext) {
    let session = AVAudioSession.sharedInstance()
    let captureId = capture.id
    observe(capture, name: AVAudioSession.mediaServicesWereLostNotification, object: session, reason: "media-services-lost")
    observe(capture, name: AVAudioSession.mediaServicesWereResetNotification, object: session, reason: "media-services-reset")
    capture.observers.append(NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification, object: session, queue: nil) { [weak self] event in
      if (event.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt) == AVAudioSession.InterruptionType.began.rawValue {
        self?.enqueueStop(captureId: captureId, reason: "audio-interruption")
      }
    })
    capture.observers.append(NotificationCenter.default.addObserver(forName: AVAudioSession.routeChangeNotification, object: session, queue: nil) { [weak self] event in
      if (event.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt) == AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue {
        self?.enqueueStop(captureId: captureId, reason: "input-route-lost")
      }
    })
    capture.observers.append(NotificationCenter.default.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: nil) { [weak self] _ in
      Self.controlQueue.async { [weak self] in
        guard let self, self.context?.id == captureId, !self.backgroundAllowed else { return }
        self.stopControlled(reason: "background-disabled")
      }
    })
    // Interruption end/foreground return never restart a stopped microphone.
  }

  private func convertAndEmit(_ input: AVAudioPCMBuffer, converter: AVAudioConverter,
    target: AVAudioFormat, timestamp: Double, captureId: String) {
    let capacity = AVAudioFrameCount(Double(input.frameLength) * target.sampleRate / input.format.sampleRate) + 1
    guard let output = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: capacity) else {
      enqueueStop(captureId: captureId, reason: "conversion-failed"); return
    }
    var error: NSError?
    var consumed = false
    let result = converter.convert(to: output, error: &error) { _, status in
      if consumed { status.pointee = .noDataNow; return nil }
      consumed = true
      status.pointee = .haveData
      return input
    }
    guard error == nil, result != .error else {
      enqueueStop(captureId: captureId, reason: "conversion-failed"); return
    }
    if output.frameLength > 0 { emitBuffer(output, timestamp: timestamp, captureId: captureId) }
  }

  private func emitBuffer(_ buffer: AVAudioPCMBuffer, timestamp: Double, captureId: String) {
    let count = Int(buffer.frameLength) * Int(buffer.format.channelCount)
    guard count > 0 else { return }
    let data: NativeArrayBuffer
    if encoding == .int16, let bytes = buffer.int16ChannelData {
      data = NativeArrayBuffer.copy(of: bytes[0], count: count * MemoryLayout<Int16>.size)
    } else if encoding == .float32, let bytes = buffer.floatChannelData {
      data = NativeArrayBuffer.copy(of: bytes[0], count: count * MemoryLayout<Float32>.size)
    } else {
      enqueueStop(captureId: captureId, reason: "conversion-failed"); return
    }
    emit(event: AUDIO_STREAM_BUFFER, payload: ["data": data,
      "sampleRate": buffer.format.sampleRate, "channels": Int(buffer.format.channelCount),
      "timestamp": timestamp, "captureId": captureId])
  }

  private func emitStatus(reason: String, captureId: String) {
    emit(event: AUDIO_STREAM_STATUS, payload: ["isStreaming": streaming, "reason": reason, "captureId": captureId])
  }

  deinit {
    // The last reference can be released by an audio callback. Never wait for
    // that callback's engine from deinit; transfer resources without retaining self.
    if let capture = context {
      let ownerId = id
      Self.controlQueue.async { Self.releaseResources(capture, ownerId: ownerId) }
    }
  }
}

internal final class AudioStreamException: GenericException<String> {
  override var reason: String { param }
}
