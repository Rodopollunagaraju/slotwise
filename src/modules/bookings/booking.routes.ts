import { Router } from 'express';
import { bookingController } from './booking.controller';
import { requireTenant } from '../../middlewares/tenant.middleware';
import { idempotencyMiddleware } from '../../middlewares/idempotency.middleware';
import { authenticate } from '../../middlewares/auth.middleware';

const router = Router();

// Create booking (idempotency-enabled)
router.post(
  '/',
  requireTenant,
  idempotencyMiddleware,
  (req, res, next) => bookingController.create(req, res, next)
);

// Get single booking
router.get(
  '/:id',
  requireTenant,
  (req, res, next) => bookingController.getById(req, res, next)
);

// List bookings (filtered by staff/status/customer)
router.get(
  '/',
  requireTenant,
  authenticate,
  (req, res, next) => bookingController.list(req, res, next)
);

// Cancel booking
router.post(
  '/:id/cancel',
  requireTenant,
  (req, res, next) => bookingController.cancel(req, res, next)
);

// Reschedule booking
router.post(
  '/:id/reschedule',
  requireTenant,
  (req, res, next) => bookingController.reschedule(req, res, next)
);

export default router;
