import { createHash } from 'crypto';
import type { IDataObject } from 'n8n-workflow';

import { isPlainObject } from '../GenericFunctions';
import { DEDUPE_MAX_MEMORY_ENTRIES, DEDUPE_MAX_STATIC_ENTRIES, DEDUPE_TTL_MS } from './constants';

/**
 * Deduplication of retried deliveries.
 *
 * Evolution retries a delivery up to 10 times over ~20 minutes whenever n8n does not answer
 * 2xx in time (timeouts, proxies, restarts), and an instance webhook plus the global webhook
 * deliver the same event twice. Every retry posts the very same object, so:
 * - messages (`messages.upsert`, `send.message`) are keyed by instance + event + key.fromMe +
 *   key.id, which also catches the same message emitted twice;
 * - every other event by a hash of instance + event + date_time + data (date_time is set once
 *   per event, so two distinct events almost never share it).
 *
 * Seen keys live in two bounded stores:
 * - the node's static data (`recentDeliveries`, at most DEDUPE_MAX_STATIC_ENTRIES), which n8n
 *   persists whenever it saves the workflow static data;
 * - an in-process cache, because n8n does not always persist static data written while a
 *   webhook request is handled, and retries normally reach the same n8n process.
 */

type DeliveryLog = Record<string, number>;

const STATIC_KEY = 'recentDeliveries';
const MAX_MEMORY_SCOPES = 200;
const memoryLogs = new Map<string, Map<string, number>>();

/** Stable key of one delivery (32 hex chars). */
export function getDeliveryKey(body: IDataObject): string {
  const event = String(body.event ?? '');
  const instance = String(body.instance ?? '');
  const data = body.data;
  let material: unknown[];
  if (
    (event === 'messages.upsert' || event === 'send.message') &&
    isPlainObject(data) &&
    isPlainObject(data.key) &&
    typeof data.key.id === 'string' &&
    data.key.id !== ''
  ) {
    // Not remoteJid: 2.4 with Chatwoot rewrites key.remoteJid on the shared object (EVOCW-10).
    material = ['message', instance, event, data.key.fromMe ?? '', data.key.id];
  } else {
    material = ['event', instance, event, body.date_time ?? '', data ?? null];
  }
  return createHash('sha256').update(JSON.stringify(material)).digest('hex').slice(0, 32);
}

function readStaticLog(staticData: IDataObject): DeliveryLog {
  const raw = staticData[STATIC_KEY];
  const log: DeliveryLog = {};
  if (!isPlainObject(raw)) return log;
  for (const [key, seenAt] of Object.entries(raw)) {
    if (typeof seenAt === 'number' && Number.isFinite(seenAt)) log[key] = seenAt;
  }
  return log;
}

function pruneMemoryLog(log: Map<string, number>, cutoff: number): void {
  // Insertion order is chronological (entries are deleted and re-set when refreshed).
  for (const [key, seenAt] of log) {
    if (seenAt > cutoff && log.size <= DEDUPE_MAX_MEMORY_ENTRIES) break;
    log.delete(key);
  }
}

function getMemoryLog(scope: string): Map<string, number> {
  let log = memoryLogs.get(scope);
  if (!log) {
    log = new Map();
    memoryLogs.set(scope, log);
    if (memoryLogs.size > MAX_MEMORY_SCOPES) {
      const oldest = memoryLogs.keys().next().value;
      if (oldest !== undefined) memoryLogs.delete(oldest);
    }
  }
  return log;
}

/**
 * Read-only check for a delivery accepted within the TTL. Do not remember a delivery until
 * building its output (including asynchronous binary storage) has succeeded.
 */
export function isDuplicateDelivery(
  staticData: IDataObject,
  scope: string,
  key: string,
  now: number,
  ttlMs = DEDUPE_TTL_MS,
): boolean {
  const cutoff = now - ttlMs;
  const memoryLog = memoryLogs.get(scope);
  const staticLog = readStaticLog(staticData);

  const seenInMemory = memoryLog?.get(key);
  const seenInStatic = staticLog[key];
  return (
    (seenInMemory !== undefined && seenInMemory > cutoff) ||
    (seenInStatic !== undefined && seenInStatic > cutoff)
  );
}

/** Record a successfully built output in both bounded stores. */
export function rememberDelivery(
  staticData: IDataObject,
  scope: string,
  key: string,
  now: number,
  ttlMs = DEDUPE_TTL_MS,
): void {
  const cutoff = now - ttlMs;
  const memoryLog = getMemoryLog(scope);
  const staticLog = readStaticLog(staticData);

  memoryLog.delete(key);
  memoryLog.set(key, now);
  pruneMemoryLog(memoryLog, cutoff);

  const kept = Object.entries(staticLog)
    .filter(([, seenAt]) => seenAt > cutoff)
    .sort((a, b) => a[1] - b[1]);
  kept.push([key, now]);
  // Assign a new object: n8n only notices changes made through the static data proxy.
  staticData[STATIC_KEY] = Object.fromEntries(kept.slice(-DEDUPE_MAX_STATIC_ENTRIES));
}

/** Forget the in-process cache (tests). */
export function resetDeliveryMemory(): void {
  memoryLogs.clear();
}
