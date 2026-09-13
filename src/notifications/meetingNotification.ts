const events = new Set(['meeting.summary.ready', 'meeting.action.assigned', 'meeting.transcript.ready']);
/** Proposed native notification payload. Never navigate to a sender-supplied URL. */
export function meetingNotificationTarget(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const value = data as Record<string, unknown>;
  if (typeof value.eventType !== 'string' || !events.has(value.eventType)) return null;
  return typeof value.meetingId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.meetingId)
    ? value.meetingId : null;
}
