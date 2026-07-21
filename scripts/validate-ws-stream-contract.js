'use strict';

const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const SCHEMA_PATH = path.join(REPO_ROOT, 'contracts/ws-stream-events.schema.json');
const PIN_PATH = path.join(
  REPO_ROOT,
  'contracts/ws-stream-events.schema.pin.json',
);
const FIXTURES_ROOT = path.join(
  REPO_ROOT,
  'contracts/fixtures/ws-stream-events',
);
const EXPECTED_EVENT_TYPES = [
  'loading',
  'ready',
  'partial',
  'final',
  'error',
  'debug',
];

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

async function main() {
  assert(
    process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0',
    'TLS verification must not be disabled during contract fetch validation',
  );

  const schemaBuffer = fs.readFileSync(SCHEMA_PATH);
  const schema = readJson(SCHEMA_PATH);
  const pin = readJson(PIN_PATH);

  assert(
    gitBlobSha(schemaBuffer) === pin.sourceBlobSha,
    `Pinned schema blob SHA mismatch: expected ${pin.sourceBlobSha}, got ${gitBlobSha(
      schemaBuffer,
    )}`,
  );
  assert(
    pin.sourceRepository === 'Halildeu/platform-ai',
    'Schema pin must reference Halildeu/platform-ai',
  );
  assert(
    pin.sourcePath === 'docs/contracts/ws-stream-events.schema.json',
    'Schema pin sourcePath must reference the canonical platform-ai contract path',
  );
  assert(
    typeof pin.sourceRef === 'string' && /^[a-f0-9]{40}$/.test(pin.sourceRef),
    'Schema pin sourceRef must be a commit SHA',
  );
  assert(
    schema.$id === 'platform-ai/ws-stream-events',
    'Schema $id changed unexpectedly',
  );
  assertEventTypes(schema);

  if (process.argv.includes('--fetch') || process.env.WS_STREAM_SCHEMA_FETCH === '1') {
    const fetchedSchemaBuffer = await fetchBuffer(pin.sourceRawUrl);

    assert(
      gitBlobSha(fetchedSchemaBuffer) === pin.sourceBlobSha,
      'Fetched canonical schema blob SHA does not match the pinned SHA',
    );
    assert(
      schemaBuffer.equals(fetchedSchemaBuffer),
      'Local pinned schema content differs from the canonical sourceRef content',
    );
  }

  validateFixtures(schema);
  console.log('ws-stream contract validation passed');
}

function assertEventTypes(schema) {
  assert(Array.isArray(schema.oneOf), 'Schema oneOf must be present');
  assert(schema.$defs && typeof schema.$defs === 'object', 'Schema $defs missing');

  const actualTypes = Object.keys(schema.$defs).sort();
  assert(
    JSON.stringify(actualTypes) === JSON.stringify([...EXPECTED_EVENT_TYPES].sort()),
    `Schema event types changed: ${actualTypes.join(', ')}`,
  );
}

function validateFixtures(schema) {
  const validFiles = collectJsonFiles(path.join(FIXTURES_ROOT, 'valid'));
  const invalidFiles = collectJsonFiles(path.join(FIXTURES_ROOT, 'invalid'));
  const validTypes = new Set();

  assert(validFiles.length > 0, 'At least one valid fixture is required');
  assert(invalidFiles.length > 0, 'At least one invalid fixture is required');

  for (const fixturePath of validFiles) {
    const payload = readJson(fixturePath);
    const errors = validateAgainstSchema(payload, schema, schema, '$');

    assert(
      errors.length === 0,
      `${fixturePath} must satisfy schema:\n${errors.join('\n')}`,
    );
    validTypes.add(payload.type);
  }

  for (const eventType of EXPECTED_EVENT_TYPES) {
    assert(validTypes.has(eventType), `Missing valid fixture for ${eventType}`);
  }

  for (const fixturePath of invalidFiles) {
    const payload = readJson(fixturePath);
    const errors = validateAgainstSchema(payload, schema, schema, '$');

    assert(
      errors.length > 0,
      `${fixturePath} is under invalid/ but unexpectedly satisfies schema`,
    );
  }
}

function validateAgainstSchema(value, schema, rootSchema, jsonPath) {
  if (schema.$ref) {
    return validateAgainstSchema(value, resolveRef(rootSchema, schema.$ref), rootSchema, jsonPath);
  }

  if (schema.oneOf) {
    const results = schema.oneOf.map((candidate) =>
      validateAgainstSchema(value, candidate, rootSchema, jsonPath),
    );
    const passingResults = results.filter((errors) => errors.length === 0);

    if (passingResults.length === 1) {
      return [];
    }

    return [
      `${jsonPath} must match exactly one schema branch, matched ${passingResults.length}`,
    ];
  }

  const errors = [];

  if (schema.type) {
    const typeError = validateType(value, schema.type, jsonPath);

    if (typeError) {
      return [typeError];
    }
  }

  if (Object.prototype.hasOwnProperty.call(schema, 'const') && value !== schema.const) {
    errors.push(`${jsonPath} must equal ${JSON.stringify(schema.const)}`);
  }

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${jsonPath} must be one of ${schema.enum.join(', ')}`);
  }

  if (
    typeof schema.minimum === 'number' &&
    typeof value === 'number' &&
    value < schema.minimum
  ) {
    errors.push(`${jsonPath} must be >= ${schema.minimum}`);
  }

  if (schema.type === 'object' && isRecord(value)) {
    const required = Array.isArray(schema.required) ? schema.required : [];
    const properties = isRecord(schema.properties) ? schema.properties : {};

    for (const key of required) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) {
        errors.push(`${jsonPath}.${key} is required`);
      }
    }

    for (const [key, propertySchema] of Object.entries(properties)) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        errors.push(
          ...validateAgainstSchema(
            value[key],
            propertySchema,
            rootSchema,
            `${jsonPath}.${key}`,
          ),
        );
      }
    }

    if (schema.additionalProperties === false) {
      const allowedKeys = new Set(Object.keys(properties));

      for (const key of Object.keys(value)) {
        if (!allowedKeys.has(key)) {
          errors.push(`${jsonPath}.${key} is not allowed`);
        }
      }
    }
  }

  return errors;
}

function validateType(value, expectedType, jsonPath) {
  if (expectedType === 'object') {
    return isRecord(value) ? null : `${jsonPath} must be an object`;
  }

  if (expectedType === 'string') {
    return typeof value === 'string' ? null : `${jsonPath} must be a string`;
  }

  if (expectedType === 'integer') {
    return typeof value === 'number' && Number.isInteger(value) && Number.isFinite(value)
      ? null
      : `${jsonPath} must be an integer`;
  }

  if (expectedType === 'number') {
    return typeof value === 'number' && Number.isFinite(value)
      ? null
      : `${jsonPath} must be a number`;
  }

  return `Unsupported schema type ${expectedType} at ${jsonPath}`;
}

function resolveRef(rootSchema, ref) {
  const pathParts = ref
    .replace(/^#\//, '')
    .split('/')
    .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'));
  let value = rootSchema;

  for (const part of pathParts) {
    value = value[part];
  }

  assert(value, `Cannot resolve schema ref ${ref}`);
  return value;
}

function collectJsonFiles(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const entryPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        return collectJsonFiles(entryPath);
      }

      return entry.isFile() && entry.name.endsWith('.json') ? [entryPath] : [];
    })
    .sort();
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function gitBlobSha(buffer) {
  return crypto
    .createHash('sha1')
    .update(`blob ${buffer.length}\0`)
    .update(buffer)
    .digest('hex');
}

function fetchBuffer(url, redirectsRemaining = 5) {
  return new Promise((resolve, reject) => {
    const request = https
      .get(url, (response) => {
        if (
          response.statusCode &&
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          if (redirectsRemaining <= 0) {
            response.resume();
            reject(new Error(`Too many redirects while fetching ${url}`));
            return;
          }

          const redirectUrl = new URL(response.headers.location, url).toString();

          response.resume();
          fetchBuffer(redirectUrl, redirectsRemaining - 1).then(resolve, reject);
          return;
        }

        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error(`GET ${url} failed with HTTP ${response.statusCode}`));
          return;
        }

        const chunks = [];
        response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        response.on('end', () => resolve(Buffer.concat(chunks)));
      })
      .on('error', reject);

    request.setTimeout(10_000, () => {
      request.destroy(new Error(`Timed out while fetching ${url}`));
    });
  });
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
