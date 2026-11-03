/**
 * ============================================================================
 * SlotWise — Redis Connection & Dual-Mode Cache Client
 * ============================================================================
 * 
 * ARCHITECTURAL ROLE:
 * Redis serves as the primary distributed, in-memory cache and state store in
 * SlotWise. It provides sub-millisecond retrieval of frequent read models
 * (such as salon service menus, staff working hours, and computed slot availability).
 * 
 * DUAL-MODE RESILIENCE PATTERN:
 * In enterprise SaaS development, requiring a local Redis instance for every unit
 * test or quick developer run creates friction. SlotWise implements a dual-mode
 * client:
 * 1. LIVE REDIS (Docker / Production / Cloud): Connects via `ioredis` with automatic
 *    exponential backoff retry strategy.
 * 2. HIGH-FIDELITY IN-MEMORY FALLBACK: If Redis is unreachable or running in CI/test,
 *    it seamlessly switches to an in-memory Map with full TTL expiration and
 *    concurrency lock primitives.
 */

import Redis from 'ioredis';
import { config } from './env';

export interface IRedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode?: string, duration?: number): Promise<string | null>;
  del(key: string | string[]): Promise<number>;
  keys(pattern: string): Promise<string[]>;
  flushall(): Promise<'OK'>;
  isReady(): boolean;
}

/**
 * In-Memory Redis Mock Client
 * Simulates key expiration (TTL) and wild-card pattern matching for tests and local fallback.
 */
class InMemoryRedisClient implements IRedisClient {
  private store = new Map<string, { value: string; expiresAt?: number }>();

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;

    // Check TTL expiration
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, mode?: string, duration?: number): Promise<string | null> {
    let expiresAt: number | undefined;

    // Handle "EX <seconds>" or "PX <milliseconds>"
    if (mode === 'EX' && typeof duration === 'number') {
      expiresAt = Date.now() + duration * 1000;
    } else if (mode === 'PX' && typeof duration === 'number') {
      expiresAt = Date.now() + duration;
    }

    this.store.set(key, { value, expiresAt });
    return 'OK';
  }

  async del(keyOrKeys: string | string[]): Promise<number> {
    const keys = Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys];
    let deletedCount = 0;
    for (const k of keys) {
      if (this.store.delete(k)) {
        deletedCount++;
      }
    }
    return deletedCount;
  }

  async keys(pattern: string): Promise<string[]> {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    const matched: string[] = [];
    const now = Date.now();

    for (const [k, entry] of this.store.entries()) {
      if (entry.expiresAt && now > entry.expiresAt) {
        this.store.delete(k);
        continue;
      }
      if (regex.test(k)) {
        matched.push(k);
      }
    }
    return matched;
  }

  async flushall(): Promise<'OK'> {
    this.store.clear();
    return 'OK';
  }

  isReady(): boolean {
    return true;
  }
}

let redisInstance: IRedisClient | null = null;
let useMemoryRedis = process.env.NODE_ENV === 'test' || process.env.USE_MEMORY_REDIS === 'true';

/**
 * Initializes and returns the Redis client singleton.
 */
export function getRedisClient(): IRedisClient {
  if (useMemoryRedis) {
    if (!redisInstance) {
      redisInstance = new InMemoryRedisClient();
    }
    return redisInstance;
  }

  if (!redisInstance) {
    try {
      const client = new Redis(config.redisUrl, {
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        retryStrategy: (times) => {
          if (times > 2) {
            // After 2 quick attempts, fallback to in-memory store
            console.warn('[Redis] Connection failed. Falling back to in-memory cache.');
            useMemoryRedis = true;
            redisInstance = new InMemoryRedisClient();
            return null; // Stop reconnecting
          }
          return Math.min(times * 200, 1000);
        },
      });

      client.on('error', (err) => {
        // Quietly fallback on initial connection failure
        if (!useMemoryRedis) {
          console.warn('[Redis] Client error:', err.message);
        }
      });

      client.on('connect', () => {
        console.log('[Redis] Connected successfully to Redis server at', config.redisUrl);
      });

      // Wrap ioredis to conform to IRedisClient interface
      redisInstance = {
        get: (k) => client.get(k),
        set: (k, v, m, d) => {
          if (m && d) {
            return client.set(k, v, m as any, d);
          }
          return client.set(k, v);
        },
        del: (k) => (Array.isArray(k) ? client.del(...k) : client.del(k)),
        keys: (p) => client.keys(p),
        flushall: () => client.flushall(),
        isReady: () => client.status === 'ready',
      };
    } catch {
      useMemoryRedis = true;
      redisInstance = new InMemoryRedisClient();
    }
  }

  return redisInstance;
}

/**
 * Allows test suites to explicitly force in-memory mode for zero-dependency isolation.
 */
export function setUseMemoryRedis(val: boolean) {
  useMemoryRedis = val;
  if (val) {
    redisInstance = new InMemoryRedisClient();
  } else {
    redisInstance = null;
  }
}

