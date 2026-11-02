import { Router } from 'express';
import { serviceController } from './service.controller';
import { requireTenant } from '../../middlewares/tenant.middleware';
import { authenticate } from '../../middlewares/auth.middleware';
import { requireRole } from '../../middlewares/rbac.middleware';

const router = Router();

// Publicly available to browse services in a salon
router.get('/', requireTenant, (req, res, next) => serviceController.list(req, res, next));
router.get('/:id', requireTenant, (req, res, next) => serviceController.getById(req, res, next));

// Owner / SuperAdmin protected
router.post(
  '/',
  requireTenant,
  authenticate,
  requireRole(['OWNER', 'SUPER_ADMIN']),
  (req, res, next) => serviceController.create(req, res, next)
);

router.delete(
  '/:id',
  requireTenant,
  authenticate,
  requireRole(['OWNER', 'SUPER_ADMIN']),
  (req, res, next) => serviceController.delete(req, res, next)
);

export default router;
