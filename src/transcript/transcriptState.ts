/**
 * Transcript state machine (PR-mobile-03, #5).
 *
 * Pure, framework-free reducer that folds the audio-gateway ws-stream events
 * (see `src/contracts/wsStreamEvents.ts`) into an ordered list of transcript
 * lines the UI can render:
 *
 *   partial  -> `draft`   (gri: confirmed + tentative)
 *   final    -> `final`   (siyah: kesin metin)
 *   final again on a settled seq -> `revised` (sonradan düzeltilen)
 *
 * Device-free by design so it is unit-testable without Expo/RN. The renderer
 * (FlatList + auto-scroll) consumes `TranscriptState.lines`.
 */
import type { WsStreamEvent } from '../contracts/wsStreamEvents';
import type { SpeakerAttribution } from './speakerAttribution';

export type TranscriptLineStatus = 'draft' | 'stabilizing' | 'final' | 'revised' | 'interrupted';

export interface TranscriptLine {
  /** Local socket generation; legacy/demo events without it belong to generation 0. */
  readonly connectionId?: number;
  readonly seq: number;
  /** Rendered text: draft = confirmed + tentative, final/revised = kesin metin. */
  readonly text: string;
  readonly confirmed: string;
  readonly tentative: string;
  readonly status: TranscriptLineStatus;
  readonly speakerAttribution?: SpeakerAttribution;
}

export interface TranscriptState {
  readonly lines: readonly TranscriptLine[];
}

/** Local UI envelope. The gateway's wire sequence and source coordinates stay unchanged. */
export type TranscriptEvent = ((WsStreamEvent
  | { type: 'partial'; seq: number; confirmed: string; tentative: string }
  | { type: 'final'; seq: number; text: string; speakerAttribution?: SpeakerAttribution })
  & { connectionId?: number })
  | { type: 'connection_interrupted'; connectionId: number };

export function transcriptLineKey(line: Pick<TranscriptLine, 'connectionId' | 'seq'>): string {
  return `${line.connectionId ?? 0}:${line.seq}`;
}

export function initialTranscriptState(): TranscriptState {
  return { lines: [] };
}

function draftText(confirmed: string, tentative: string): string {
  return [confirmed.trim(), tentative.trim()].filter(Boolean).join(' ');
}

/** A gateway sequence starts again on reconnect. Replace only within its socket. */
function upsertSorted(
  lines: readonly TranscriptLine[],
  line: TranscriptLine,
): TranscriptLine[] {
  const next = lines.filter((existing) => transcriptLineKey(existing) !== transcriptLineKey(line));
  next.push(line);
  next.sort((a, b) => (a.connectionId ?? 0) - (b.connectionId ?? 0) || a.seq - b.seq);
  return next;
}

/**
 * Fold a single ws-stream event into the transcript state.
 * Non-transcript events (loading/ready/error/debug) leave the lines untouched.
 * A `partial` never resurrects a line that has already settled (final/revised).
 */
export function applyTranscriptEvent(
  state: TranscriptState,
  event: TranscriptEvent,
): TranscriptState {
  switch (event.type) {
    case 'connection_interrupted': {
      let changed = false;
      const lines = state.lines.map(line => {
        if ((line.connectionId ?? 0) !== event.connectionId ||
            (line.status !== 'draft' && line.status !== 'stabilizing')) return line;
        changed = true;
        return { ...line, status: 'interrupted' as const };
      });
      return changed ? { lines } : state;
    }
    case 'partial': {
      const existing = state.lines.find((line) => transcriptLineKey(line) === transcriptLineKey(event));
      if (existing && ['final', 'revised', 'interrupted'].includes(existing.status)) {
        return state; // settled/interrupted lines never become live drafts again
      }
      const line: TranscriptLine = {
        ...(event.connectionId !== undefined ? { connectionId: event.connectionId } : {}),
        seq: event.seq,
        confirmed: event.confirmed,
        tentative: event.tentative,
        text: draftText(event.confirmed, event.tentative),
        status: event.confirmed.trim() ? 'stabilizing' : 'draft',
      };
      return { lines: upsertSorted(state.lines, line) };
    }
    case 'final': {
      const existing = state.lines.find((line) => transcriptLineKey(line) === transcriptLineKey(event));
      if (existing?.status === 'interrupted') return state; // closed socket callbacks are obsolete
      const alreadySettled = existing?.status === 'final' || existing?.status === 'revised';
      const speakerAttribution = 'speakerAttribution' in event ? event.speakerAttribution : undefined;
      if (alreadySettled && existing.text === event.text &&
          JSON.stringify(existing.speakerAttribution) === JSON.stringify(speakerAttribution)) return state;
      const line: TranscriptLine = {
        ...(event.connectionId !== undefined ? { connectionId: event.connectionId } : {}),
        seq: event.seq,
        confirmed: event.text,
        tentative: '',
        text: event.text,
        status: alreadySettled ? 'revised' : 'final',
        ...(speakerAttribution ? { speakerAttribution } : {}),
      };
      return { lines: upsertSorted(state.lines, line) };
    }
    default:
      return state;
  }
}

/** Convenience: fold many events (e.g. a reconnect replay) in order. */
export function applyTranscriptEvents(
  state: TranscriptState,
  events: readonly TranscriptEvent[],
): TranscriptState {
  return events.reduce(applyTranscriptEvent, state);
}
