export const WS_STREAM_EVENT_TYPES = [
  'loading',
  'ready',
  'partial',
  'final',
  'error',
  'debug',
] as const;

export type WsStreamEventType = (typeof WS_STREAM_EVENT_TYPES)[number];

export type WsLoadingEvent = {
  type: 'loading';
  stage: 'live_model' | 'final_model';
};

export type WsReadyEvent = {
  type: 'ready';
  sample_rate: number;
  live_model: string;
  final_model: string;
};

export type WsPartialEvent = {
  type: 'partial';
  seq: number;
  confirmed: string;
  tentative: string;
  elapsed_ms: number;
  rms: number;
  source: string;
};

export type WsFinalEvent = {
  type: 'final';
  seq: number;
  text: string;
  reason: string;
  elapsed_ms: number;
  rms: number;
};

export type WsErrorEvent = {
  type: 'error';
  msg: string;
};

export type WsDebugEvent = {
  type: 'debug';
  event: string;
  [key: string]: unknown;
};

export type WsStreamEvent =
  | WsLoadingEvent
  | WsReadyEvent
  | WsPartialEvent
  | WsFinalEvent
  | WsErrorEvent
  | WsDebugEvent;

export type WsStreamEventValidationResult =
  | { ok: true; event: WsStreamEvent }
  | { ok: false; errors: string[] };

const EVENT_TYPE_SET = new Set<string>(WS_STREAM_EVENT_TYPES);

export function validateWsStreamEvent(
  payload: unknown,
): WsStreamEventValidationResult {
  if (!isRecord(payload)) {
    return invalid('event must be an object');
  }

  if (typeof payload.type !== 'string' || !EVENT_TYPE_SET.has(payload.type)) {
    return invalid(
      `type must be one of: ${WS_STREAM_EVENT_TYPES.join(', ')}`,
    );
  }

  switch (payload.type) {
    case 'loading':
      return validateLoading(payload);
    case 'ready':
      return validateReady(payload);
    case 'partial':
      return validatePartial(payload);
    case 'final':
      return validateFinal(payload);
    case 'error':
      return validateError(payload);
    case 'debug':
      return validateDebug(payload);
    default:
      return invalid('unsupported event type');
  }
}

export function parseWsStreamEvent(payload: unknown): WsStreamEvent {
  const result = validateWsStreamEvent(payload);

  if (!result.ok) {
    throw new Error(`Invalid ws-stream event: ${result.errors.join('; ')}`);
  }

  return result.event;
}

function validateLoading(
  payload: Record<string, unknown>,
): WsStreamEventValidationResult {
  const errors = [
    ...requireKeys(payload, ['type', 'stage']),
    ...forbidExtraKeys(payload, ['type', 'stage']),
    ...expectEnum(payload, 'stage', ['live_model', 'final_model']),
  ];

  return toResult(payload as WsLoadingEvent, errors);
}

function validateReady(
  payload: Record<string, unknown>,
): WsStreamEventValidationResult {
  const errors = [
    ...requireKeys(payload, [
      'type',
      'sample_rate',
      'live_model',
      'final_model',
    ]),
    ...forbidExtraKeys(payload, [
      'type',
      'sample_rate',
      'live_model',
      'final_model',
    ]),
    ...expectInteger(payload, 'sample_rate', 8000),
    ...expectString(payload, 'live_model'),
    ...expectString(payload, 'final_model'),
  ];

  return toResult(payload as WsReadyEvent, errors);
}

function validatePartial(
  payload: Record<string, unknown>,
): WsStreamEventValidationResult {
  const errors = [
    ...requireKeys(payload, [
      'type',
      'seq',
      'confirmed',
      'tentative',
      'elapsed_ms',
      'rms',
      'source',
    ]),
    ...forbidExtraKeys(payload, [
      'type',
      'seq',
      'confirmed',
      'tentative',
      'elapsed_ms',
      'rms',
      'source',
    ]),
    ...expectInteger(payload, 'seq', 0),
    ...expectString(payload, 'confirmed'),
    ...expectString(payload, 'tentative'),
    ...expectInteger(payload, 'elapsed_ms', 0),
    ...expectNumber(payload, 'rms', 0),
    ...expectString(payload, 'source'),
  ];

  return toResult(payload as WsPartialEvent, errors);
}

function validateFinal(
  payload: Record<string, unknown>,
): WsStreamEventValidationResult {
  const errors = [
    ...requireKeys(payload, [
      'type',
      'seq',
      'text',
      'reason',
      'elapsed_ms',
      'rms',
    ]),
    ...forbidExtraKeys(payload, [
      'type',
      'seq',
      'text',
      'reason',
      'elapsed_ms',
      'rms',
    ]),
    ...expectInteger(payload, 'seq', 0),
    ...expectString(payload, 'text'),
    ...expectString(payload, 'reason'),
    ...expectInteger(payload, 'elapsed_ms', 0),
    ...expectNumber(payload, 'rms', 0),
  ];

  return toResult(payload as WsFinalEvent, errors);
}

function validateError(
  payload: Record<string, unknown>,
): WsStreamEventValidationResult {
  const errors = [
    ...requireKeys(payload, ['type', 'msg']),
    ...forbidExtraKeys(payload, ['type', 'msg']),
    ...expectString(payload, 'msg'),
  ];

  return toResult(payload as WsErrorEvent, errors);
}

function validateDebug(
  payload: Record<string, unknown>,
): WsStreamEventValidationResult {
  const errors = [
    ...requireKeys(payload, ['type', 'event']),
    ...expectString(payload, 'event'),
  ];

  return toResult(payload as WsDebugEvent, errors);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireKeys(
  payload: Record<string, unknown>,
  requiredKeys: string[],
): string[] {
  return requiredKeys
    .filter((key) => !Object.prototype.hasOwnProperty.call(payload, key))
    .map((key) => `${key} is required`);
}

function forbidExtraKeys(
  payload: Record<string, unknown>,
  allowedKeys: string[],
): string[] {
  const allowed = new Set(allowedKeys);

  return Object.keys(payload)
    .filter((key) => !allowed.has(key))
    .map((key) => `${key} is not allowed`);
}

function expectString(
  payload: Record<string, unknown>,
  key: string,
): string[] {
  if (!Object.prototype.hasOwnProperty.call(payload, key)) {
    return [];
  }

  return typeof payload[key] === 'string' ? [] : [`${key} must be a string`];
}

function expectEnum(
  payload: Record<string, unknown>,
  key: string,
  allowedValues: string[],
): string[] {
  if (!Object.prototype.hasOwnProperty.call(payload, key)) {
    return [];
  }

  return typeof payload[key] === 'string' &&
    allowedValues.includes(payload[key])
    ? []
    : [`${key} must be one of: ${allowedValues.join(', ')}`];
}

function expectInteger(
  payload: Record<string, unknown>,
  key: string,
  minimum: number,
): string[] {
  if (!Object.prototype.hasOwnProperty.call(payload, key)) {
    return [];
  }

  const value = payload[key];

  return typeof value === 'number' &&
    Number.isInteger(value) &&
    Number.isFinite(value) &&
    value >= minimum
    ? []
    : [`${key} must be an integer >= ${minimum}`];
}

function expectNumber(
  payload: Record<string, unknown>,
  key: string,
  minimum: number,
): string[] {
  if (!Object.prototype.hasOwnProperty.call(payload, key)) {
    return [];
  }

  const value = payload[key];

  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= minimum
    ? []
    : [`${key} must be a number >= ${minimum}`];
}

function toResult(
  event: WsStreamEvent,
  errors: string[],
): WsStreamEventValidationResult {
  return errors.length === 0 ? { ok: true, event } : { ok: false, errors };
}

function invalid(error: string): WsStreamEventValidationResult {
  return { ok: false, errors: [error] };
}
