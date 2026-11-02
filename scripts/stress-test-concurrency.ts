/**
 * SlotWise Concurrency Stress Test Script
 * Simulates high-load concurrent booking attempts targeting the EXACT same staff member and slot.
 * Verifies that the PostgreSQL exclusion constraint (or concurrency engine) allows strictly 1 booking
 * and returns 409 Conflict for all remaining requests.
 */

import request from 'supertest';
import app from '../src/app';
import { memoryDb } from '../src/db/memory-db';

async function runStressTest(concurrency = 100) {
  console.log('===============================================================');
  console.log(`🚀 Starting Concurrency Stress Test (${concurrency} concurrent requests)`);
  console.log('===============================================================');

  memoryDb.reset();
  const tenantSlug = 'stress-salon';

  // 1. Setup Tenant, Service, and Staff
  const tRes = await request(app)
    .post('/api/v1/auth/register-tenant')
    .send({
      slug: tenantSlug,
      salonName: 'High Load Salon',
      email: 'owner@stress.com',
      password: 'Password123!',
    });
  const token = tRes.body.data.token;

  const sRes = await request(app)
    .post('/api/v1/services')
    .set('Authorization', `Bearer ${token}`)
    .set('X-Tenant-Slug', tenantSlug)
    .send({
      name: 'Signature Express Cut',
      durationMin: 30,
      price: 50.0,
      depositAmount: 15.0,
    });
  const serviceId = sRes.body.data.id;

  const stRes = await request(app)
    .post('/api/v1/staff')
    .set('Authorization', `Bearer ${token}`)
    .set('X-Tenant-Slug', tenantSlug)
    .send({
      name: 'Master Stylist Liam',
      email: 'liam@stress.com',
      serviceIds: [serviceId],
    });
  const staffId = stRes.body.data.id;

  const targetSlot = '2026-11-20T10:00:00.000Z';

  console.log(`Targeting staff: ${staffId}`);
  console.log(`Targeting slot:  ${targetSlot}`);
  console.log(`Firing ${concurrency} simultaneous booking requests...`);

  const startTime = Date.now();
  const latencies: number[] = [];

  const promises = Array.from({ length: concurrency }).map(async (_, idx) => {
    const reqStart = Date.now();
    const res = await request(app)
      .post('/api/v1/bookings')
      .set('X-Tenant-Slug', tenantSlug)
      .send({
        serviceId,
        staffId,
        startAt: targetSlot,
        customerName: `Stress User ${idx + 1}`,
        customerEmail: `stress${idx + 1}@loadtest.com`,
      });
    const reqEnd = Date.now();
    latencies.push(reqEnd - reqStart);
    return res;
  });

  const results = await Promise.all(promises);
  const totalDuration = Date.now() - startTime;

  const successes = results.filter((r) => r.status === 201);
  const conflicts = results.filter((r) => r.status === 409);
  const otherErrors = results.filter((r) => r.status !== 201 && r.status !== 409);

  // Latency metrics
  latencies.sort((a, b) => a - b);
  const minLatency = latencies[0];
  const maxLatency = latencies[latencies.length - 1];
  const avgLatency = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
  const p95Latency = latencies[Math.floor(latencies.length * 0.95)];

  console.log('\n--- 📊 Test Results ---');
  console.log(`Total Requests:      ${concurrency}`);
  console.log(`Total Elapsed Time:  ${totalDuration} ms`);
  console.log(`Throughput:          ${Math.round((concurrency / (totalDuration / 1000)) * 10) / 10} req/s`);
  console.log(`Min Latency:         ${minLatency} ms`);
  console.log(`Avg Latency:         ${avgLatency} ms`);
  console.log(`p95 Latency:         ${p95Latency} ms`);
  console.log(`Max Latency:         ${maxLatency} ms`);
  console.log('\n--- 🛡️ Concurrency Invariant Check ---');
  console.log(`✅ Successful bookings (201 Created):   ${successes.length}`);
  console.log(`🛑 Conflicted bookings (409 Conflict):  ${conflicts.length}`);
  console.log(`⚠️ Other Errors:                       ${otherErrors.length}`);

  if (successes.length === 1 && conflicts.length === concurrency - 1 && otherErrors.length === 0) {
    console.log('\n🎉 PASS: ZERO DOUBLE BOOKINGS! The DB exclusion constraint successfully protected the slot.');
  } else {
    console.error('\n❌ FAIL: Invariant violated! Expected strictly 1 success and 0 double bookings.');
    process.exit(1);
  }
}

const count = process.argv[2] ? parseInt(process.argv[2], 10) : 100;
runStressTest(count);
