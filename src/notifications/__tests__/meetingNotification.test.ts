import { meetingNotificationTarget } from '../meetingNotification';
const meetingId = '06dbefb9-242b-4b4d-b4d5-d444e66b6dfe';
it.each(['meeting.summary.ready', 'meeting.action.assigned', 'meeting.transcript.ready'])('accepts known event %s', eventType => {
  expect(meetingNotificationTarget({ eventType, meetingId, url: 'https://untrusted.invalid' })).toBe(meetingId);
});
it.each([null, {}, { eventType: 'other', meetingId }, { eventType: 'meeting.summary.ready', meetingId: '../secret' }])('rejects invalid target %j', data => {
  expect(meetingNotificationTarget(data)).toBeNull();
});
