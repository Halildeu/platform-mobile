export interface RecordingProvenance {
  recordingOutcome: 'UNKNOWN' | 'FINISHED' | 'INCOMPLETE';
  recordingIncompleteReason: 'CLOSURE_UNCONFIRMED' | null;
}

/** Missing legacy fields mean unknown, never complete; present evidence must be coherent. */
export function parseRecordingProvenance(value: object, invalid: () => Error): RecordingProvenance {
  const p = value as Record<string, unknown>;
  const hasOutcome = Object.prototype.hasOwnProperty.call(p, 'recordingOutcome');
  const hasReason = Object.prototype.hasOwnProperty.call(p, 'recordingIncompleteReason');
  const outcome = !hasOutcome && !hasReason ? 'UNKNOWN' : p.recordingOutcome;
  if (outcome !== 'UNKNOWN' && outcome !== 'FINISHED' && outcome !== 'INCOMPLETE') throw invalid();
  if (!hasOutcome && hasReason) throw invalid();
  if (outcome === 'INCOMPLETE') {
    if (!hasReason || p.recordingIncompleteReason !== 'CLOSURE_UNCONFIRMED') throw invalid();
  } else if (hasReason && p.recordingIncompleteReason !== null) throw invalid();
  return { recordingOutcome: outcome, recordingIncompleteReason: outcome === 'INCOMPLETE' ? 'CLOSURE_UNCONFIRMED' : null };
}
