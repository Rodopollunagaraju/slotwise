import { outboxWorker } from '../modules/outbox/outbox.worker';
import { bookingExpiryWorker } from './booking-expiry.worker';

console.log('[Worker] Starting SlotWise background worker service...');

outboxWorker.start(5000);
bookingExpiryWorker.start(30000);

process.on('SIGTERM', () => {
  console.log('[Worker] SIGTERM received. Shutting down workers gracefully...');
  outboxWorker.stop();
  bookingExpiryWorker.stop();
  process.exit(0);
});
