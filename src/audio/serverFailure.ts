/** Fixed gateway-owned codes only; provider messages can contain sensitive data. */
export const SERVER_FAILURE_CODES = [
  'SPEECHMATICS_BUFFER_ERROR', 'SPEECHMATICS_DATA_ERROR', 'SPEECHMATICS_JOB_ERROR',
  'SPEECHMATICS_NOT_AUTHORISED', 'SPEECHMATICS_NOT_ALLOWED', 'SPEECHMATICS_QUOTA_EXCEEDED',
  'SPEECHMATICS_TIMELIMIT_EXCEEDED', 'SPEECHMATICS_IDLE_TIMEOUT', 'SPEECHMATICS_INVALID_MESSAGE',
  'SERVER_ERROR_UNCLASSIFIED',
] as const;
export type ServerFailureCode = typeof SERVER_FAILURE_CODES[number];
export function serverFailureCode(value: unknown): ServerFailureCode {
  return typeof value === 'string' && (SERVER_FAILURE_CODES as readonly string[]).includes(value)
    ? value as ServerFailureCode : 'SERVER_ERROR_UNCLASSIFIED';
}
