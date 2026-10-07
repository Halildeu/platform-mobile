// Optional native extension: older APKs/Expo Go do not acquire iOS capability.
export type PcmLifecycleStream = {
  readonly workcubePcmLifecycleVersion?: number;
  readonly workcubeCaptureId?: string;
  readonly workcubeLastStopReason?: string;
  readonly isStreaming?: boolean;
  configureBackgroundCapture?: (enabled: boolean) => void;
};
export type PcmStatus = { isStreaming: boolean; reason?: string; captureId?: string };
export const supportsPcmLifecycle = (stream?: PcmLifecycleStream) =>
  stream?.workcubePcmLifecycleVersion === 1 && typeof stream.configureBackgroundCapture === 'function';

const reasons: Record<string, string> = {
  'audio-interruption': 'iOS ses kaydını bir çağrı veya başka bir ses kesintisi nedeniyle durdurdu.',
  'media-services-lost': 'iOS ses servisine bağlantı kesildi; mikrofon durduruldu.',
  'media-services-reset': 'iOS ses servisi yeniden başlatıldı; mikrofon durduruldu.',
  'input-route-lost': 'Kullanılan mikrofon veya kulaklık bağlantısı kesildi; kayıt durduruldu.',
  'engine-configuration-changed': 'iOS ses aygıtının yapılandırması değişti; kayıt durduruldu.',
  'background-disabled': 'Arka plan kaydı kapalıyken uygulama arka plana geçti; mikrofon durduruldu.',
  'conversion-failed': 'Mikrofon sesi gerekli biçime dönüştürülemedi; kayıt durduruldu.',
  'start-failed': 'iOS mikrofonu başlatamadı; açılan ses kaynakları kapatıldı.',
  requested: 'Mikrofon uygulamanın durdurma isteğiyle kapandı.',
};
export function nativePcmStopReason(event: PcmStatus): string {
  const key = event.reason ?? '';
  return Object.prototype.hasOwnProperty.call(reasons, key) ? reasons[key] : 'Kayıt cihaz tarafından durduruldu; ayrıntılı neden alınamadı.';
}

// Status can arrive before start() resolves. Distinguish it from a queued stop
// belonging to the previous recording on the same native SharedObject.
export class PcmStartAttempt {
  private requested = false;
  private previousCaptureId?: string;
  request(stream: PcmLifecycleStream) {
    this.previousCaptureId = stream.workcubeCaptureId;
    this.requested = true;
  }
  clear() { this.requested = false; this.previousCaptureId = undefined; }
  acceptsBuffer(event: { captureId?: string }, stream: PcmLifecycleStream) {
    if (!this.requested) return false;
    return !supportsPcmLifecycle(stream) || (typeof event.captureId === 'string' && event.captureId.length > 0
      && event.captureId !== this.previousCaptureId && event.captureId === stream.workcubeCaptureId);
  }
  stopReasonAfterStart(stream: PcmLifecycleStream): string | undefined {
    const event = { isStreaming: !!stream.isStreaming, captureId: stream.workcubeCaptureId, reason: stream.workcubeLastStopReason };
    return event.reason && supportsPcmLifecycle(stream) && this.acceptsStop(event, stream, true)
      ? nativePcmStopReason(event) : undefined;
  }
  acceptsStop(event: PcmStatus, stream: PcmLifecycleStream, captureStarted: boolean) {
    if (event.isStreaming || !this.requested) return false;
    if (supportsPcmLifecycle(stream)) {
      return typeof event.captureId === 'string' && event.captureId.length > 0
        && event.captureId !== this.previousCaptureId && event.captureId === stream.workcubeCaptureId;
    }
    return captureStarted;
  }
}
