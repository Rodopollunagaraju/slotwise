/**
 * ============================================================================
 * SlotWise — Transactional Outbox Relay Worker (with BullMQ Queue Bridge)
 * ============================================================================
 * 
 * ARCHITECTURAL ROLE:
 * Guarantees "at-least-once" delivery of business events to the background job
 * queue without relying on 2-Phase Commit (2PC) or distributed transactions.
 * 
 * HOW THE OUTBOX RELAY PATTERN WORKS:
 * 1. During booking creation or cancellation, the API writes to BOTH the
 *    `bookings` table and the `outbox` table in ONE atomic ACID database transaction.
 * 2. If the database crashes, neither row is saved (zero data inconsistency).
 * 3. This `OutboxWorker` runs independently in the background, continuously polling
 *    for rows where `status = 'PENDING'`.
 * 4. For each pending event, it parses the payload and enqueues the relevant
 *    job into the BullMQ / Redis-compatible `queueService`.
 * 5. Upon successful queue ingestion, it marks the outbox row as `PUBLISHED`.
 * 
 * AUTOMATIC 24-HOUR REMINDER SCHEDULING:
 * When a booking is confirmed, the outbox worker calculates the reminder delay:
 * `delayMs = (booking.startAt - 24 hours) - now`. If that moment is in the
 * future, it enqueues a delayed job that will automatically execute 24h prior!
 */

import { db } from '../../config/database';
import { queueService } from '../queue/queue.service';

export class OutboxWorker {
  private timer: NodeJS.Timeout | null = null;

  async processPendingEvents(): Promise<number> {
    const res = await db.query(
      "SELECT * FROM outbox WHERE status = 'PENDING' ORDER BY created_at ASC LIMIT 50"
    );
    const events = res.rows;

    for (const evt of events) {
      try {
        const rawPayload = typeof evt.payload === 'string' ? JSON.parse(evt.payload) : evt.payload;
        const payload = rawPayload || {};

        // Fetch tenant details for branding in emails
        const tenantRes = await db.query('SELECT name FROM tenants WHERE id = $1', [evt.tenant_id]);
        const salonName = tenantRes.rows[0]?.name || 'Your Salon';

        // Bridge outbox event to asynchronous job queue
        switch (evt.event_type) {
          case 'booking.confirmed': {
            // 1. Enqueue immediate booking confirmation email
            await queueService.add(
              'send-booking-confirmation',
              {
                customerName: payload.customerName || 'Valued Customer',
                customerEmail: payload.customerEmail,
                serviceName: payload.serviceName || 'Salon Service',
                staffName: payload.staffName || 'Your Stylist',
                startAt: payload.startAt,
                depositAmount: Number(payload.depositAmount || 0),
                salonName,
              },
              { priority: 'HIGH' }
            );

            // 2. Schedule 24h prior reminder if appointment is more than 24 hours away
            if (payload.startAt) {
              const appointmentTime = new Date(payload.startAt).getTime();
              const reminderTime = appointmentTime - 24 * 60 * 60 * 1000;
              const delayMs = reminderTime - Date.now();

              if (delayMs > 0) {
                await queueService.add(
                  'send-24h-reminder',
                  {
                    customerName: payload.customerName || 'Valued Customer',
                    customerEmail: payload.customerEmail,
                    serviceName: payload.serviceName || 'Salon Service',
                    staffName: payload.staffName || 'Your Stylist',
                    startAt: payload.startAt,
                    salonName,
                  },
                  { delayMs, priority: 'DEFAULT' }
                );
              }
            }
            break;
          }

          case 'booking.cancelled': {
            // Enqueue immediate cancellation & refund notification
            await queueService.add(
              'send-cancellation-notice',
              {
                customerName: payload.customerName || 'Valued Customer',
                customerEmail: payload.customerEmail,
                serviceName: payload.serviceName || 'Salon Service',
                refundNotice: payload.isEligibleForRefund
                  ? 'Your deposit has been scheduled for a full refund.'
                  : 'Notice: Deposit forfeited due to cancellation within the 24-hour window.',
                salonName,
              },
              { priority: 'HIGH' }
            );
            break;
          }

          default: {
            // Generic outbox events logged for audit trail
            console.log(`[OutboxWorker] Relayed event '${evt.event_type}' for ${evt.aggregate_type} [${evt.aggregate_id}]`);
          }
        }

        // Mark as PUBLISHED
        await db.query(
          "UPDATE outbox SET status = 'PUBLISHED', published_at = NOW() WHERE id = $1",
          [evt.id]
        );
      } catch (err: any) {
        console.error(`[OutboxWorker] Failed to process outbox event ${evt.id}:`, err);
        await db.query(
          "UPDATE outbox SET retry_count = retry_count + 1, last_error = $1 WHERE id = $2",
          [err.message, evt.id]
        );
      }
    }

    return events.length;
  }

  start(intervalMs = 3000) {
    if (this.timer) return;
    console.log(`[OutboxWorker] Started Transactional Outbox relay (running every ${intervalMs / 1000}s)...`);
    this.timer = setInterval(() => {
      this.processPendingEvents().catch((err) => {
        console.error('[OutboxWorker] Error processing outbox events:', err);
      });
    }, intervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

export const outboxWorker = new OutboxWorker();
