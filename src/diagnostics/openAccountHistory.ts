import { lifecycleOwner } from '../audio/liveTestApi';
import { DiagnosticOpenError } from './openFailure';
/** Native storage stays outside the web-preview module graph until requested. */
export async function openAccountHistory(jwt: string, current: () => boolean) {
  const owner = await lifecycleOwner(jwt).catch(() => { throw new DiagnosticOpenError('HISTORY_IDENTITY'); });
  if (!current()) return null;
  const { openDiagnosticHistory } = await import('./nativeHistory').catch(() => { throw new DiagnosticOpenError('HISTORY_MODULE'); });
  if (!current()) return null;
  return openDiagnosticHistory(owner);
}
