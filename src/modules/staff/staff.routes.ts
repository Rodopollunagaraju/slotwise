import { Router } from 'express';
import { staffController } from './staff.controller';
import { requireTenant } from '../../middlewares/tenant.middleware';
import { authenticate } from '../../middlewares/auth.middleware';
import { requireRole } from '../../middlewares/rbac.middleware';

const router = Router();

// Publicly view staff list
router.get('/', requireTenant, (req, res, next) => staffController.list(req, res, next));
router.get('/:id', requireTenant, (req, res, next) => staffController.getById(req, res, next));

// Owner / SuperAdmin protected
router.post(
  '/',
  requireTenant,
  authenticate,
  requireRole(['OWNER', 'SUPER_ADMIN']),
  (req, res, next) => staffController.create(req, res, next)
);

router.post(
  '/:id/services',
  requireTenant,
  authenticate,
  requireRole(['OWNER', 'SUPER_ADMIN']),
  (req, res, next) => staffController.assignService(req, res, next)
);

export default router;
