import express from 'express';
import cors from 'cors';
import { tenantResolver } from './middlewares/tenant.middleware';
import { errorHandler } from './middlewares/error.middleware';

import authRoutes from './modules/auth/auth.routes';
import serviceRoutes from './modules/services/service.routes';
import staffRoutes from './modules/staff/staff.routes';
import availabilityRoutes from './modules/availability/availability.routes';
import slotRoutes from './modules/slots/slot.routes';
import bookingRoutes from './modules/bookings/booking.routes';
import paymentRoutes from './modules/payments/payment.routes';
import webhookRoutes from './modules/webhooks/webhook.routes';

const app = express();

app.use(cors());

// Parse JSON with raw body capture for webhook signature verification
app.use(
  express.json({
    verify: (req: any, _res, buf) => {
      req.rawBody = buf.toString();
    },
  })
);

app.use(express.urlencoded({ extended: true }));

// Tenant resolver runs on every request
app.use(tenantResolver);

// Health & Readiness probes
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/ready', (_req, res) => {
  res.status(200).json({ ready: true });
});

// Main API Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/services', serviceRoutes);
app.use('/api/v1/staff', staffRoutes);
app.use('/api/v1/availability', availabilityRoutes);
app.use('/api/v1/slots', slotRoutes);
app.use('/api/v1/bookings', bookingRoutes);
app.use('/api/v1/payments', paymentRoutes);
app.use('/api/v1/webhooks', webhookRoutes);

// Centralized Error Handler (handles PostgreSQL 23P01 exclusion constraints)
app.use(errorHandler);

export default app;
