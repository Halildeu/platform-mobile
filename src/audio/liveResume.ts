export interface LiveResumeCursor { sourceEpoch: string; afterFinal: number }
export const LIVE_RESUME_PROTOCOL = 'recording-resume-v1';
export function liveResumeQuery(cursor?: LiveResumeCursor): string {
  return `?resume_protocol=${LIVE_RESUME_PROTOCOL}` + (cursor
    ? `&source_epoch=${encodeURIComponent(cursor.sourceEpoch)}&after_final=${cursor.afterFinal}` : '');
}
