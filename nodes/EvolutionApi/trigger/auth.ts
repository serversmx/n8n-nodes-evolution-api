import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import type { IDataObject } from 'n8n-workflow';

import { isPlainObject } from '../GenericFunctions';

/**
 * Verification of incoming Evolution webhooks.
 *
 * Evolution never signs the payload (no HMAC). A per-instance webhook can only prove where it
 * comes from through its `webhook.headers` (spec §8.4):
 * - `jwt_key`: Evolution removes it from the headers and sends `Authorization: Bearer <JWT>`,
 *   HS256-signed with that secret, claims `{ iat, exp: iat + 600, app: 'evolution',
 *   action: 'webhook' }` (webhook.controller.ts generateJwtToken, 2.3.7 and 2.4). The token is
 *   created once per event and reused by every retry, hence the expiry leeway.
 * - any other header is forwarded as-is, e.g. a random secret in `x-evolution-secret`.
 * The global webhook (WEBHOOK_GLOBAL_URL) sends neither, so it cannot be authenticated.
 */

export type VerificationResult = { valid: true } | { valid: false; reason: string };

export interface VerificationConfig {
  /** Verify `Authorization: Bearer <JWT>` with this HS256 secret. */
  jwtSecret?: string;
  /** Verify that header `name` equals `value`. */
  secretHeader?: { name: string; value: string };
  /** Accepted delay after the JWT `exp` claim, in seconds. */
  jwtLeewaySeconds: number;
  /** Current time in seconds (injectable for tests). */
  nowSeconds: number;
}

type IncomingHeaders = Record<string, string | string[] | undefined>;

const VALID: VerificationResult = { valid: true };

function invalid(reason: string): VerificationResult {
  return { valid: false, reason };
}

/** Random secret for `jwt_key` / the secret header (256 bits, hex). */
export function generateSecret(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}

/**
 * Constant-time string comparison. Both values are hashed first, so neither the content nor
 * the length of the expected secret leaks through timing.
 */
export function safeEqual(actual: string, expected: string): boolean {
  const left = createHash('sha256').update(actual, 'utf8').digest();
  const right = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(left, right);
}

/** Header value by (case-insensitive) name; the first one when a header is repeated. */
export function getHeaderValue(headers: IncomingHeaders, name: string): string | undefined {
  const wanted = name.toLowerCase();
  const key = Object.keys(headers).find((header) => header.toLowerCase() === wanted);
  const value = key === undefined ? undefined : headers[key];
  if (Array.isArray(value)) return value[0];
  return value;
}

/** Token of an `Authorization: Bearer <token>` header. */
export function getBearerToken(headers: IncomingHeaders): string | undefined {
  const authorization = getHeaderValue(headers, 'authorization');
  const match = /^Bearer\s+(\S+)\s*$/i.exec(authorization ?? '');
  return match ? match[1] : undefined;
}

function decodeJsonSegment(segment: string): unknown {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) return undefined;
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
}

/**
 * Verify an Evolution webhook JWT: HS256 signature (compared in constant time on the canonical
 * base64url form), `alg` pinned to HS256 (no `none`, no algorithm confusion), the claims
 * `app === 'evolution'` and `action === 'webhook'`, and `exp` plus the leeway.
 */
export function verifyEvolutionJwt(
  token: string,
  secret: string,
  options: { nowSeconds: number; leewaySeconds: number },
): VerificationResult {
  const parts = token.split('.');
  if (parts.length !== 3) return invalid('malformed JWT');
  const [encodedHeader, encodedPayload, signature] = parts;

  const header = decodeJsonSegment(encodedHeader);
  const payload = decodeJsonSegment(encodedPayload);
  if (!isPlainObject(header) || !isPlainObject(payload)) return invalid('malformed JWT');
  if (header.alg !== 'HS256') return invalid(`unsupported JWT algorithm "${String(header.alg)}"`);

  const expected = createHmac('sha256', secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64url');
  if (!safeEqual(signature, expected)) return invalid('invalid JWT signature');

  const claims = payload as IDataObject;
  if (claims.app !== 'evolution' || claims.action !== 'webhook') {
    return invalid('unexpected JWT claims');
  }
  if (typeof claims.exp !== 'number' || !Number.isFinite(claims.exp)) {
    return invalid('JWT without expiry');
  }
  if (options.nowSeconds > claims.exp + Math.max(0, options.leewaySeconds)) {
    return invalid('JWT expired');
  }
  return VALID;
}

/** Apply every configured check; the first failure wins. No check configured → valid. */
export function verifyWebhookRequest(
  headers: IncomingHeaders,
  config: VerificationConfig,
): VerificationResult {
  if (config.secretHeader) {
    const received = getHeaderValue(headers, config.secretHeader.name);
    if (received === undefined) return invalid(`missing header "${config.secretHeader.name}"`);
    if (!safeEqual(received, config.secretHeader.value)) {
      return invalid(`wrong value in header "${config.secretHeader.name}"`);
    }
  }

  if (config.jwtSecret !== undefined) {
    const token = getBearerToken(headers);
    if (!token) return invalid('missing "Authorization: Bearer" JWT');
    const result = verifyEvolutionJwt(token, config.jwtSecret, {
      nowSeconds: config.nowSeconds,
      leewaySeconds: config.jwtLeewaySeconds,
    });
    if (!result.valid) return result;
  }

  return VALID;
}
