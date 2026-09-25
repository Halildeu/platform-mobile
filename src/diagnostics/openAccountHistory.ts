import { lifecycleOwner } from '../audio/liveTestApi';
/** Native storage stays outside the web-preview module graph until requested. */
export async function openAccountHistory(jwt: string, current: () => boolean) {
  const owner = await lifecycleOwner(jwt);
  if (!current()) return null;
  const { openDiagnosticHistory } = await import('./nativeHistory');
  if (!current()) return null;
  return openDiagnosticHistory(owner);
}
