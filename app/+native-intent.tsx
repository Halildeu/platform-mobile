import { redirectAuthPath } from '../src/audio/authRedirect';

export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }): string {
  return redirectAuthPath(path, initial);
}
