import type { TranscriptLine } from '../transcript/transcriptState';
import type { AnalysisSnapshot } from '../analysis/liveAnalysis';

type View = { lines: readonly TranscriptLine[]; analysis: AnalysisSnapshot | null; diagnostics: string[] };
// Short-lived navigation continuity only. Never a claim of server persistence.
const entries = new Map<string, { expires: number; value: View }>();
export function saveMeetingView(id: string, value: View) {
  entries.delete(id);
  entries.set(id, { expires: Date.now() + 60 * 60 * 1000, value: {
    lines: value.lines.slice(-2000), analysis: value.analysis, diagnostics: value.diagnostics.slice(-300),
  } });
  while (entries.size > 5) entries.delete(entries.keys().next().value!);
}
export function readMeetingView(id: string): View | undefined {
  for (const [key, entry] of entries) if (entry.expires <= Date.now()) entries.delete(key);
  return entries.get(id)?.value;
}
export function clearMeetingViews() { entries.clear(); }
