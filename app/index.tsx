import { StyleSheet, Text, View } from 'react-native';

/**
 * Index screen — initial entry.
 *
 * Sonraki PR'larda:
 * - PR-mobile-01: Keycloak SSO PKCE login redirect
 * - PR-mobile-02: Meeting list + create
 */
export default function IndexScreen(): JSX.Element {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Workcube Meeting Intelligence</Text>
      <Text style={styles.subtitle}>Faz 24 M6 Integration — skeleton</Text>
      <Text style={styles.note}>
        Next: Keycloak SSO + audio capture + live transcript
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    backgroundColor: '#0f172a',
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    color: '#e2e8f0',
    marginBottom: 12,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: '#94a3b8',
    marginBottom: 24,
  },
  note: {
    fontSize: 13,
    color: '#64748b',
    textAlign: 'center',
  },
});
