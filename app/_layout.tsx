import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import '../src/i18n'; // i18next global örneğini başlatır (Türkçe varsayılan)

/**
 * Root layout — Expo Router file-based routing.
 *
 * Faz 24 M6 Integration — PR-mobile-01 skeleton.
 * Auth guard + Redux Provider sonraki sliceler'de eklenecek.
 */
export default function RootLayout() {
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
