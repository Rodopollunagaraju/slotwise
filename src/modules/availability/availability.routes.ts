import { Router } from 'express';
import { availabilityController } from './availability.controller';
import { requireTenant } from '../../middlewares/tenant.middleware';
import { authenticate } from '../../middlewares/auth.middleware';
import { requireRole } from '../../middlewares/rbac.middleware';

const router = Router();

// Schedule queries
router.get('/staff/:staffId', requireTenant, (req, res, next) =>
  availabilityController.getStaffSchedule(req, res, next)
);

router.get('/time-off/staff/:staffId', requireTenant, (req, res, next) =>
  availabilityController.getStaffTimeOff(req, res, next)
);

// Staff can view/edit own schedule; Owner and SuperAdmin can edit any
router.post(
  '/',
  requireTenant,
  authenticate,
  requireRole(['OWNER', 'STAFF', 'SUPER_ADMIN']),
  (req, res, next) => availabilityController.setWorkingHours(req, res, next)
);

router.post(
  '/time-off',
  requireTenant,
  authenticate,
  requireRole(['OWNER', 'STAFF', 'SUPER_ADMIN']),
  (req, res, next) => availabilityController.addTimeOff(req, res, next)
);

export default router;
