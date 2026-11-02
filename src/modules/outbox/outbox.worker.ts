import { db } from '../../config/database';

export class OutboxWorker {
  private timer: NodeJS.Timeout | null = null;

  async processPendingEvents(): Promise<number> {
    const res = await db.query(
      "SELECT * FROM outbox WHERE status = 'PENDING' ORDER BY created_at ASC LIMIT 50"
    );
    const events = res.rows;

    for (const evt of events) {
      try {
        const payload = typeof evt.payload === 'string' ? JSON.parse(evt.payload) : evt.payload;

        // Simulate dispatching email / notification queue (BullMQ / Resend / SendGrid)
        console.log(`[OutboxWorker] Dispatching event '${evt.event_type}' for ${evt.aggregate_type} [${evt.aggregate_id}]:`, {
          tenantId: evt.tenant_id,
          payloadSummary: Object.keys(payload),
        });

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

  start(intervalMs = 5000) {
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
