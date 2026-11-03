/**
 * ============================================================================
 * SlotWise — Multi-Tenant Cache Service & Stampede Protection
 * ============================================================================
 * 
 * CORE DESIGN PATTERNS:
 * 
 * 1. CACHE-ASIDE (LAZY LOADING):
 *    The application first inspects Redis for the requested dataset.
 *    - Cache HIT: Return immediately (latency ~1-3ms).
 *    - Cache MISS: Query PostgreSQL, write the result into Redis with a TTL,
 *      and return to client.
 * 
 * 2. CACHE STAMPEDE (DOG-PILING / THUNDERING HERD) MITIGATION:
 *    Problem:
 *    Imagine a salon where 500 customers look up available Saturday haircut
 *    slots simultaneously. If the Redis key expires, all 500 requests
 *    simultaneously experience a cache miss and barrage PostgreSQL with 500
 *    complex range-overlap queries, spiking DB CPU to 100% and saturating
 *    the connection pool.
 * 
 *    Solution: Single-Flight Mutex (`inFlightPromises`):
 *    When `getOrSet()` is called, if another request is already fetching that
 *    exact key from the database, subsequent concurrent requests do NOT call
 *    the database. Instead, they subscribe to the in-flight Promise and await
 *    the exact same result! This reduces 500 database queries down to exactly 1.
 * 
 * 3. TENANT-AWARE KEY NAMESPACING:
 *    All keys are strictly partitioned with `tenant:{tenantId}:{resource}:...`
 *    guaranteeing zero cross-tenant cache contamination.
 * 
 * 4. EVENT-DRIVEN INVALIDATION:
 *    When bookings are created/cancelled or service catalogs are updated,
 *    `delPattern("tenant:{tenantId}:slots:*")` purges obsolete caches
 *    instantly, ensuring fresh availability numbers.
 */

import { getRedisClient, IRedisClient } from '../config/redis';

export class CacheService {
  private client: IRedisClient;
  // Single-flight map to deduplicate concurrent backend fetches for the same key
  private inFlightPromises = new Map<string, Promise<any>>();

  constructor() {
    this.client = getRedisClient();
  }

  /**
   * Generates a tenant-scoped cache key.
   */
  buildKey(tenantId: string, resource: string, ...segments: string[]): string {
    const rest = segments.filter(Boolean).join(':');
    return rest ? `tenant:${tenantId}:${resource}:${rest}` : `tenant:${tenantId}:${resource}`;
  }

  /**
   * Fetches an item from cache, parsing JSON if applicable.
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      const data = await this.client.get(key);
      if (!data) return null;
      return JSON.parse(data) as T;
    } catch (err) {
      console.warn(`[CacheService] Error reading key "${key}":`, err);
      return null;
    }
  }

  /**
   * Sets an item in cache with a Time-To-Live (TTL) in seconds.
   */
  async set(key: string, value: any, ttlSeconds: number): Promise<void> {
    try {
      const serialized = JSON.stringify(value);
      await this.client.set(key, serialized, 'EX', ttlSeconds);
    } catch (err) {
      console.warn(`[CacheService] Error writing key "${key}":`, err);
    }
  }

  /**
   * Deletes a specific key.
   */
  async del(key: string): Promise<void> {
    try {
      await this.client.del(key);
    } catch (err) {
      console.warn(`[CacheService] Error deleting key "${key}":`, err);
    }
  }

  /**
   * Invalidates all keys matching a wildcard pattern (e.g. "tenant:uuid:slots:*")
   */
  async delPattern(pattern: string): Promise<number> {
    try {
      const matchedKeys = await this.client.keys(pattern);
      if (matchedKeys.length > 0) {
        return await this.client.del(matchedKeys);
      }
      return 0;
    } catch (err) {
      console.warn(`[CacheService] Error deleting pattern "${pattern}":`, err);
      return 0;
    }
  }

  /**
   * Cache-aside with Single-Flight Cache Stampede Protection:
   * 
   * 1. Check Redis cache. If hit, return immediately.
   * 2. If miss, check if another asynchronous call is currently computing
   *    this exact key. If so, share and await that exact Promise.
   * 3. If neither, execute the `fetcher()` database query, store result
   *    in Redis with TTL, clean up in-flight tracker, and return value.
   */
  async getOrSet<T>(key: string, ttlSeconds: number, fetcher: () => Promise<T>): Promise<T> {
    // 1. Try Cache Hit
    const cached = await this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    // 2. Single-Flight Mutex: Avoid duplicate DB queries for identical in-flight key
    if (this.inFlightPromises.has(key)) {
      return (await this.inFlightPromises.get(key)) as T;
    }

    // 3. Initiate the database fetcher wrapped in a tracked Promise
    const fetchPromise = (async () => {
      try {
        const freshData = await fetcher();
        if (freshData !== undefined && freshData !== null) {
          await this.set(key, freshData, ttlSeconds);
        }
        return freshData;
      } finally {
        // Guarantee clean-up of the in-flight lock whether it succeeded or failed
        this.inFlightPromises.delete(key);
      }
    })();

    this.inFlightPromises.set(key, fetchPromise);
    return await fetchPromise;
  }
}

export const cacheService = new CacheService();

