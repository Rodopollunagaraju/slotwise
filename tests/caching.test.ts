/**
 * ============================================================================
 * SlotWise — Week 5 Test Suite: Redis Caching & Cache Stampede Protection
 * ============================================================================
 * 
 * TESTS VERIFY:
 * 1. Cache-Aside Hit & Miss: Data fetched from DB on first call, then served
 *    instantly from Redis on subsequent calls.
 * 2. Cache Stampede (Dog-Piling) Protection: When 10 concurrent requests ask
 *    for slots on an uncached key, exactly 1 database fetch is performed while
 *    the other 9 requests latch onto the in-flight Promise.
 * 3. Event-Driven Cache Invalidation: Modifying services or creating a booking
 *    automatically purges stale cache keys.
 */

import { cacheService } from '../src/services/cache.service';
import { serviceService } from '../src/modules/services/service.service';
import { bookingService } from '../src/modules/bookings/booking.service';
import { setUseMemoryDb } from '../src/config/database';
import { setUseMemoryRedis } from '../src/config/redis';

describe('Week 5: Redis Caching & Cache Stampede Protection', () => {
  const tenantId = 'tenant_cache_test_1';

  beforeAll(() => {
    setUseMemoryDb(true);
    setUseMemoryRedis(true);
  });

  beforeEach(async () => {
    // Clear pattern keys before each test
    await cacheService.delPattern('tenant:*');
  });

  test('Cache-Aside: fetches from DB on first call, serves from cache on second call', async () => {
    let dbCallCount = 0;
    const testFetcher = async () => {
      dbCallCount++;
      return [{ id: 'svc_1', name: 'Signature Haircut' }];
    };

    const cacheKey = cacheService.buildKey(tenantId, 'test-resource');

    // First call: Cache MISS -> calls fetcher
    const data1 = await cacheService.getOrSet(cacheKey, 60, testFetcher);
    expect(data1).toHaveLength(1);
    expect(dbCallCount).toBe(1);

    // Second call: Cache HIT -> returns cached data, does NOT call fetcher
    const data2 = await cacheService.getOrSet(cacheKey, 60, testFetcher);
    expect(data2).toEqual(data1);
    expect(dbCallCount).toBe(1); // Call count remains 1!
  });

  test('Cache Stampede Protection: 10 concurrent requests execute fetcher only ONCE', async () => {
    let slowFetchCount = 0;

    // Simulated expensive slot calculation that takes 50ms
    const expensiveSlotFetcher = async () => {
      slowFetchCount++;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { availableSlots: ['09:00', '09:30', '10:00'] };
    };

    const cacheKey = cacheService.buildKey(tenantId, 'slots', 'date-2026-11-10');

    // Launch 10 simultaneous requests for the exact same key
    const requests = Array.from({ length: 10 }).map(() =>
      cacheService.getOrSet(cacheKey, 30, expensiveSlotFetcher)
    );

    const results = await Promise.all(requests);

    // All 10 requests should receive the identical payload
    expect(results).toHaveLength(10);
    expect(results[0].availableSlots).toEqual(['09:00', '09:30', '10:00']);

    // Single-Flight Mutex Guarantee: fetcher was called exactly ONCE!
    expect(slowFetchCount).toBe(1);
  });

  test('Event-Driven Invalidation: Adding a new service invalidates tenant service cache', async () => {
    // 1. Initial list (populates cache)
    await serviceService.listServices(tenantId);

    const cacheKey = cacheService.buildKey(tenantId, 'services');
    const cachedBefore = await cacheService.get(cacheKey);
    expect(cachedBefore).not.toBeNull();

    // 2. Create new service -> triggers cache invalidation
    await serviceService.createService(tenantId, {
      name: 'Beard Grooming VIP',
      durationMin: 30,
      price: 45,
      depositAmount: 15,
    });

    // 3. Cache key must now be deleted
    const cachedAfter = await cacheService.get(cacheKey);
    expect(cachedAfter).toBeNull();
  });
});

