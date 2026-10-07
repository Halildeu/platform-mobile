import type { LiveText } from '../audio/foregroundStream';
import type { AnalysisSnapshot } from '../analysis/liveAnalysis';
import { readSpeakerAttribution } from '../transcript/speakerAttribution';

export const DETAIL_MAX_RETENTION_MS = 86400000;
export const DETAIL_LIMIT = 5000;
export const DETAIL_DURATION_MS = 180000;
export const DETAIL_STORAGE_BYTES = 2 * 1024 * 1024;
export const DETAIL_REPORT_CHARACTERS = 512 * 1024;
const RUN_LIMIT = 2000;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Payload = Record<string, unknown>;
export type DetailEntry = { at: number; expiresAt: number; meeting: string; runId: string; payload: Payload };
const object = (v: unknown): v is Payload => !!v && typeof v === 'object' && !Array.isArray(v);
const integer = (v: unknown, max = Number.MAX_SAFE_INTEGER): v is number => Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) <= max;

/** Revalidate on both write and read. Arbitrary provider/error/header fields never enter this report. */
export function cleanDetail(input: Payload): Payload {
  const out: Payload = { kind: input.kind };
  let truncated = input.truncated === true;
  const text = (value: unknown, cap = 4096) => {
    if (typeof value !== 'string') return '';
    if (value.length > cap) truncated = true;
    return value.slice(0, cap);
  };
  const number = (key: string) => { if (integer(input[key])) out[key] = input[key]; };
  switch (input.kind) {
    case 'begin':
      out.platform = ['android', 'ios', 'web'].includes(String(input.platform)) ? input.platform : 'unknown';
      out.durationLimitMs = DETAIL_DURATION_MS;
      break;
    case 'session':
      if (typeof input.sessionId === 'string' && (uuid.test(input.sessionId) || /^SES-[A-Za-z0-9._:-]{1,124}$/.test(input.sessionId))) out.sessionId = input.sessionId;
      break;
    case 'gateway_text': {
      number('seq'); out.final = input.final === true;
      out.text = text(input.text);
      if (typeof input.confirmed === 'string') out.confirmed = text(input.confirmed);
      if (typeof input.tentative === 'string') out.tentative = text(input.tentative);
      if (integer(input.sourceStartSample) && integer(input.sourceEndSample) && input.sourceEndSample > input.sourceStartSample) {
        out.sourceStartSample = input.sourceStartSample; out.sourceEndSample = input.sourceEndSample;
        const attribution = readSpeakerAttribution(input.speakerAttribution, String(out.text), input.sourceStartSample, input.sourceEndSample);
        if (attribution && attribution.turns.length <= 32) out.speakerAttribution = attribution;
        else if (input.speakerAttribution) truncated = true;
      }
      break;
    }
    case 'analysis_output':
      number('version'); number('observedAfterFinalSeq'); out.partial = input.partial === true; out.microphoneOpen = input.microphoneOpen === true;
      out.summary = text(input.summary, 1000);
      if (Array.isArray(input.decisions)) {
        if (input.decisions.length > 20) truncated = true;
        out.decisions = input.decisions.slice(0, 20).map(item => text(item, 500));
      }
      if (Array.isArray(input.actions)) {
        if (input.actions.length > 20) truncated = true;
        out.actions = input.actions.slice(0, 20).filter(object).map(item => ({ text: text(item.text, 1000),
          owner: item.owner == null ? null : text(item.owner, 160), dueDate: item.dueDate == null ? null : text(item.dueDate, 160) }));
      }
      break;
    case 'pcm':
      out.sampleOriginKnown = input.sampleOriginKnown === true;
      for (const key of ['callbackCount', 'maxCallbackGapMs', 'sendAccepted', 'sendRejected', 'generatedFrames', 'lastSentSeq', 'lastAckSeq']) number(key);
      if (Array.isArray(input.windows)) out.windows = input.windows.slice(0, 10).filter(object).map(item => {
        const window: Payload = {};
        for (const key of ['firstSample', 'samples', 'rms', 'peak', 'zeroSamples', 'longestZeroRun']) if (integer(item[key])) window[key] = item[key];
        return window;
      });
      break;
    case 'pcm_gap':
      out.reason = input.reason === 'oversize' ? 'oversize' : 'unsupported_format';
      for (const key of ['bytes', 'sampleRate', 'channels', 'skippedSamples']) number(key);
      out.sampleOriginKnown = input.sampleOriginKnown === true;
      break;
    case 'draining': break;
    case 'end':
      out.reason = ['stopped', 'duration', 'limit', 'closed'].includes(String(input.reason)) ? input.reason : 'closed';
      number('events');
      break;
    default: throw new Error('Geçersiz ayrıntılı tanılama olayı.');
  }
  if (truncated) out.truncated = true;
  // Control characters can expand sixfold in JSON. Keep even adversarial text under a row budget.
  if (JSON.stringify(out).length > 50000) {
    const shorten = (value: unknown): unknown => typeof value === 'string' ? value.slice(0, 64)
      : Array.isArray(value) ? value.map(shorten) : object(value) ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shorten(item)])) : value;
    const bounded = shorten(out) as Payload;
    delete bounded.speakerAttribution; // Offsets would no longer refer to the shortened text.
    return { ...bounded, truncated: true };
  }
  return out;
}
export function decodeDetail(raw: string, meeting: string): DetailEntry {
  if (raw.length > 60000) throw new Error('Ayrıntılı tanılama kaydı çok büyük.');
  const value = JSON.parse(raw);
  if (!object(value) || !integer(value.at) || !integer(value.expiresAt) || value.expiresAt <= value.at || value.expiresAt - value.at > DETAIL_MAX_RETENTION_MS || value.meeting !== meeting || !uuid.test(meeting) ||
    typeof value.runId !== 'string' || !uuid.test(value.runId) || !object(value.payload)) throw new Error('Ayrıntılı tanılama kaydı geçersiz.');
  return { at: value.at, expiresAt: value.expiresAt, meeting, runId: value.runId, payload: cleanDetail(value.payload) };
}

/** Only created after the one-run UI opt-in. PCM is measured, never retained. */
export class DetailedCapture {
  private readonly started: number;
  private ended = false;
  private audioEnded = false;
  private count = 0;
  private finalSeq: number | undefined;
  private sample = 0;
  private sampleOriginKnown = true;
  private window = { firstSample: 0, samples: 0, squares: 0, peak: 0, zeroSamples: 0, longestZeroRun: 0 };
  private zeros = 0;
  private windows: Payload[] = [];
  private callbackCount = 0;
  private previousAt: number | undefined;
  private maxGap = 0;
  private accepted = 0;
  private rejected = 0;
  private transport: Payload = {};
  constructor(private readonly write: (payload: Payload, at: number) => boolean, platform: string, private readonly now = Date.now,
    private readonly clock = () => performance.now()) {
    this.started = clock(); this.event({ kind: 'begin', platform });
  }
  private available() {
    if (this.ended) return false;
    if (this.clock() - this.started >= DETAIL_DURATION_MS) { this.stop('duration'); return false; }
    if (this.count >= RUN_LIMIT) { this.stop('limit'); return false; }
    return true;
  }
  private event(payload: Payload) {
    if (!this.available()) return;
    try { if (!this.write(cleanDetail(payload), this.now())) this.ended = true; else this.count++; }
    catch { this.ended = true; } // A diagnostic must never interrupt microphone delivery.
  }
  session(sessionId: string) { this.event({ kind: 'session', sessionId }); }
  text(line: LiveText) {
    if (line.final) this.finalSeq = line.seq;
    this.event({ kind: 'gateway_text', ...line });
  }
  analysis(snapshot: AnalysisSnapshot, microphoneOpen: boolean) {
    this.event({ kind: 'analysis_output', ...snapshot, observedAfterFinalSeq: this.finalSeq, microphoneOpen });
  }
  draining() { this.audioEnded = true; this.finishWindow(); this.flush(); this.event({ kind: 'draining' }); }
  pcm(data: ArrayBuffer, sampleRate: number, channels: number, at: number, accepted: boolean, transport: Payload) {
    if (!this.available() || this.audioEnded) return;
    const validFormat = sampleRate === 16000 && channels === 1 && data.byteLength % 2 === 0;
    if (!validFormat || data.byteLength > 32000) {
      this.finishWindow(); this.flush();
      if (validFormat) this.sample += data.byteLength / 2;
      else this.sampleOriginKnown = false;
      this.finishWindow(); // Reset the next window's offset past any known skipped samples.
      this.previousAt = at;
      this.event({ kind: 'pcm_gap', reason: validFormat ? 'oversize' : 'unsupported_format', bytes: data.byteLength,
        sampleRate, channels, ...(validFormat ? { skippedSamples: data.byteLength / 2 } : {}), sampleOriginKnown: this.sampleOriginKnown });
      return;
    }
    this.callbackCount++;
    if (this.previousAt !== undefined) this.maxGap = Math.max(this.maxGap, Math.max(0, at - this.previousAt));
    this.previousAt = at;
    if (accepted) this.accepted++; else this.rejected++;
    this.transport = transport;
    const bytes = new DataView(data);
    for (let i = 0; i < data.byteLength; i += 2) {
      const value = bytes.getInt16(i, true); const w = this.window;
      this.sample++; w.samples++; w.squares += value * value; w.peak = Math.max(w.peak, Math.abs(value));
      this.zeros = value === 0 ? this.zeros + 1 : 0;
      if (value === 0) w.zeroSamples++;
      w.longestZeroRun = Math.max(w.longestZeroRun, this.zeros);
      if (w.samples === 1600) this.finishWindow();
      if (this.windows.length === 10) this.flush();
    }
  }
  private finishWindow() {
    const { squares, ...window } = this.window;
    if (window.samples) this.windows.push({ ...window, rms: Math.round(Math.sqrt(squares / window.samples)) });
    this.window = { firstSample: this.sample, samples: 0, squares: 0, peak: 0, zeroSamples: 0, longestZeroRun: 0 };
    this.zeros = 0;
  }
  private flush() {
    if (!this.windows.length) return;
    const payload = { kind: 'pcm', windows: this.windows, sampleOriginKnown: this.sampleOriginKnown, callbackCount: this.callbackCount, maxCallbackGapMs: this.maxGap,
      sendAccepted: this.accepted, sendRejected: this.rejected, ...this.transport };
    this.windows = []; this.callbackCount = 0; this.maxGap = 0; this.accepted = 0; this.rejected = 0;
    this.event(payload);
  }
  stop(reason: 'stopped' | 'duration' | 'limit' | 'closed' = 'stopped') {
    if (this.ended) return;
    // Prevent re-entry when a limit is discovered while flushing.
    this.ended = true;
    this.finishWindow();
    try {
      if (this.windows.length && reason === 'stopped') this.write(cleanDetail({ kind: 'pcm', windows: this.windows, sampleOriginKnown: this.sampleOriginKnown,
        callbackCount: this.callbackCount, maxCallbackGapMs: this.maxGap, sendAccepted: this.accepted, sendRejected: this.rejected, ...this.transport }), this.now());
      this.write({ kind: 'end', reason, events: this.count }, this.now());
    } catch { /* storage failure is reported by the account journal */ }
    this.windows = [];
  }
}
