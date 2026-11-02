import app from './app';
import { config } from './config/env';
import { runMigrations } from './db/migrate';
import { seedDatabase } from './db/seed';
import { outboxWorker } from './modules/outbox/outbox.worker';
import { bookingExpiryWorker } from './jobs/booking-expiry.worker';

async function bootstrap() {
  try {
    // 1. Run migrations & seed demo dataset
    await runMigrations();
    await seedDatabase();

    // 2. Start background jobs
    outboxWorker.start(10000);
    bookingExpiryWorker.start(60000);

    // 3. Start HTTP server
    const server = app.listen(config.port, () => {
      console.log(`🚀 SlotWise API Gateway is running on port ${config.port} in ${config.nodeEnv} mode`);
      console.log(`🔗 Health check available at http://localhost:${config.port}/health`);
    });

    // Graceful shutdown
    const gracefulShutdown = () => {
      console.log('Stopping workers and closing server...');
      outboxWorker.stop();
      bookingExpiryWorker.stop();
      server.close(() => {
        console.log('HTTP server closed.');
        process.exit(0);
      });
    };

    process.on('SIGINT', gracefulShutdown);
    process.on('SIGTERM', gracefulShutdown);
  } catch (err) {
    console.error('Failed to start application:', err);
    process.exit(1);
  }
}

bootstrap();
