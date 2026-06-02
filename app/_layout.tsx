import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

/**
 * Root layout — Expo Router file-based routing.
 *
 * Faz 24 M6 Integration — PR-mobile-01 skeleton.
 * Auth guard, Redux Provider, i18n init sonraki sliceler'de eklenecek.
 */
export default function RootLayout(): JSX.Element {
  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: '#1e293b' },
          headerTintColor: '#e2e8f0',
          headerTitleStyle: { fontWeight: '600' },
          contentStyle: { backgroundColor: '#0f172a' },
        }}
      />
    </>
  );
}
