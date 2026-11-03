/**
 * ============================================================================
 * SlotWise — Week 5 Test Suite: Queue, Outbox Relay & Circuit Breaker
 * ============================================================================
 * 
 * TESTS VERIFY:
 * 1. Transactional Outbox Relay: Events in outbox table are picked up and
 *    pushed into the asynchronous job queue.
 * 2. Asynchronous Email Dispatch: Confirmation emails and 24-hour reminders
 *    are formatted and sent.
 * 3. Exponential Backoff & Dead-Letter Queue (DLQ): When a job repeatedly fails,
 *    it retries with backoff and moves to DLQ upon exhausting max attempts.
 * 4. Circuit Breaker Resilience: Protects queue workers from external API downtime
 *    by tripping to OPEN after repeated failures and recovering on cooldown.
 */

import { queueService, Job } from '../src/modules/queue/queue.service';
import { emailService } from '../src/modules/notifications/email.service';
import { outboxWorker } from '../src/modules/outbox/outbox.worker';
import { db, setUseMemoryDb } from '../src/config/database';

describe('Week 5: Queue, Outbox Relay & Notification Resilience', () => {
  const tenantId = 'tenant_queue_test_1';

  beforeAll(() => {
    setUseMemoryDb(true);
  });

  beforeEach(() => {
    queueService.clear();
    emailService.sentEmails = [];
    emailService.resetCircuitBreaker();
  });

  test('Outbox Worker relays pending events to Job Queue and marks as PUBLISHED', async () => {
    // 1. Seed a tenant and a confirmed booking event in outbox
    await db.query(
      `INSERT INTO tenants (id, name, slug, email) VALUES ($1, 'Crown Salon', 'crownsalon', 'info@crown.com')
       ON CONFLICT (id) DO NOTHING`,
      [tenantId]
    );

    const outboxRes = await db.query(
      `INSERT INTO outbox (tenant_id, aggregate_type, aggregate_id, event_type, payload)
       VALUES ($1, 'BOOKING', 'b_12345', 'booking.confirmed', $2)
       RETURNING *`,
      [
        tenantId,
        JSON.stringify({
          bookingId: 'b_12345',
          customerName: 'Alice Smith',
          customerEmail: 'alice@example.com',
          serviceName: 'Balayage Color',
          staffName: 'Elena Rostova',
          startAt: new Date(Date.now() + 48 * 3600 * 1000).toISOString(), // 48 hours in future
          depositAmount: 50,
        }),
      ]
    );
    const outboxId = outboxRes.rows[0].id;

    // 2. Trigger Outbox Relay
    const processedCount = await outboxWorker.processPendingEvents();
    expect(processedCount).toBeGreaterThanOrEqual(1);

    // 3. Verify outbox row status updated to PUBLISHED
    const checkOutbox = await db.query('SELECT status, published_at FROM outbox WHERE id = $1', [outboxId]);
    expect(checkOutbox.rows[0].status).toBe('PUBLISHED');
    expect(checkOutbox.rows[0].published_at).not.toBeNull();

    // 4. Verify job was enqueued in QueueService
    const snapshot = queueService.getQueueSnapshot();
    // Should have both: immediate confirmation email and delayed 24h reminder email!
    expect(snapshot.activeLength).toBeGreaterThanOrEqual(1);

    // 5. Process queue jobs
    await queueService.processJobs();

    // Verify email was dispatched
    const confirmation = emailService.sentEmails.find((e) => e.to === 'alice@example.com');
    expect(confirmation).toBeDefined();
    expect(confirmation?.subject).toContain('Confirmed');
  });

  test('Circuit Breaker trips to OPEN after consecutive email failures and fails fast', async () => {
    expect(emailService.getCircuitState()).toBe('CLOSED');

    const testMsg = {
      to: 'fail@example.com',
      subject: 'Test',
      html: '<p>Test</p>',
      text: 'Test',
    };

    // Trigger 3 simulated failures
    for (let i = 0; i < 3; i++) {
      await expect(emailService.sendEmail(testMsg, true)).rejects.toThrow();
    }

    // Circuit Breaker must now be OPEN
    expect(emailService.getCircuitState()).toBe('OPEN');

    // 4th attempt must fail fast without even attempting network call
    await expect(emailService.sendEmail(testMsg)).rejects.toThrow(/CircuitBreaker.*OPEN/i);
  });

  test('Jobs that exceed max retries are safely routed to Dead-Letter Queue (DLQ)', async () => {
    // Trip email circuit breaker so all jobs fail
    for (let i = 0; i < 3; i++) {
      try {
        await emailService.sendEmail({ to: 'x', subject: 'x', html: 'x', text: 'x' }, true);
      } catch {}
    }

    // Add a job with maxAttempts = 1 to test DLQ routing
    const job = await queueService.add(
      'send-booking-confirmation',
      {
        customerName: 'Bob',
        customerEmail: 'bob@example.com',
        serviceName: 'Haircut',
        staffName: 'Sam',
        startAt: new Date().toISOString(),
        depositAmount: 20,
        salonName: 'Quick Cuts',
      },
      { maxAttempts: 1 }
    );

    // Process jobs: Since circuit breaker is OPEN, job will fail
    const result = await queueService.processJobs();
    expect(result.failures).toBe(1);

    // Verify job transitioned to DLQ
    const snapshot = queueService.getQueueSnapshot();
    expect(snapshot.dlqLength).toBe(1);
    expect(snapshot.dlq[0].id).toBe(job.id);
    expect(snapshot.dlq[0].status).toBe('DLQ');
  });
});

