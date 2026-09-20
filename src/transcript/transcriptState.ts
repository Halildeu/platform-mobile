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

export type TranscriptLineStatus = 'draft' | 'stabilizing' | 'final' | 'revised';

export interface TranscriptLine {
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

export function initialTranscriptState(): TranscriptState {
  return { lines: [] };
}

function draftText(confirmed: string, tentative: string): string {
  return [confirmed.trim(), tentative.trim()].filter(Boolean).join(' ');
}

/** Replace (by seq) or insert, keeping the list ordered by seq ascending. */
function upsertSorted(
  lines: readonly TranscriptLine[],
  line: TranscriptLine,
): TranscriptLine[] {
  const next = lines.filter((existing) => existing.seq !== line.seq);
  next.push(line);
  next.sort((a, b) => a.seq - b.seq);
  return next;
}

/**
 * Fold a single ws-stream event into the transcript state.
 * Non-transcript events (loading/ready/error/debug) leave the lines untouched.
 * A `partial` never resurrects a line that has already settled (final/revised).
 */
export function applyTranscriptEvent(
  state: TranscriptState,
  event: WsStreamEvent | { type: 'partial'; seq: number; confirmed: string; tentative: string } | { type: 'final'; seq: number; text: string; speakerAttribution?: SpeakerAttribution },
): TranscriptState {
  switch (event.type) {
    case 'partial': {
      const existing = state.lines.find((line) => line.seq === event.seq);
      if (existing && (existing.status === 'final' || existing.status === 'revised')) {
        return state; // final/revised wins over a late partial
      }
      const line: TranscriptLine = {
        seq: event.seq,
        confirmed: event.confirmed,
        tentative: event.tentative,
        text: draftText(event.confirmed, event.tentative),
        status: event.confirmed.trim() ? 'stabilizing' : 'draft',
      };
      return { lines: upsertSorted(state.lines, line) };
    }
    case 'final': {
      const existing = state.lines.find((line) => line.seq === event.seq);
      const alreadySettled = existing?.status === 'final' || existing?.status === 'revised';
      const speakerAttribution = 'speakerAttribution' in event ? event.speakerAttribution : undefined;
      if (alreadySettled && existing.text === event.text &&
          JSON.stringify(existing.speakerAttribution) === JSON.stringify(speakerAttribution)) return state;
      const line: TranscriptLine = {
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
  events: readonly WsStreamEvent[],
): TranscriptState {
  return events.reduce(applyTranscriptEvent, state);
}
