/** expo-sqlite exposes a native POSIX path; expo-file-system requires a file URI. */
export function databaseFileUri(directory: string): string {
  if (directory.startsWith('file:///')) return directory;
  if (!directory.startsWith('/') || directory.startsWith('//') || directory.includes('\0')) throw new Error('Invalid database directory');
  // Encode path segments, preserving slashes and literal %, # and ? in native paths.
  return `file://${directory.split('/').map(encodeURIComponent).join('/')}`;
}
