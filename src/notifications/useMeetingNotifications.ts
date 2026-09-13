import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { meetingNotificationTarget } from './meetingNotification';

export function useMeetingNotifications() {
  const router = useRouter();
  useEffect(() => {
    let mounted = true;
    let lastId = '';
    const handle = (response: Notifications.NotificationResponse | null) => {
      if (!mounted || !response || response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
      const request = response.notification.request;
      if (request.identifier === lastId) return;
      const meetingId = meetingNotificationTarget(request.content.data);
      if (!meetingId) return;
      lastId = request.identifier;
      router.navigate({ pathname: '/live-test', params: { notificationMeetingId: meetingId } });
      void Notifications.clearLastNotificationResponseAsync().catch(() => {});
    };
    const listener = Notifications.addNotificationResponseReceivedListener(handle);
    void Notifications.getLastNotificationResponseAsync().then(handle).catch(() => {});
    return () => { mounted = false; listener.remove(); };
  }, [router]);
}
