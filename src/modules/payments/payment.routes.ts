import { Router } from 'express';
import { paymentController } from './payment.controller';
import { requireTenant } from '../../middlewares/tenant.middleware';
import { idempotencyMiddleware } from '../../middlewares/idempotency.middleware';

const router = Router();

// Create order / payment intent with idempotency
router.post(
  '/create-order',
  requireTenant,
  idempotencyMiddleware,
  (req, res, next) => paymentController.createOrder(req, res, next)
);

export default router;
