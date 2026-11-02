import { Router } from 'express';
import { slotController } from './slot.controller';
import { requireTenant } from '../../middlewares/tenant.middleware';

const router = Router();

// Public endpoint for customer or staff to check slot availability
router.get('/', requireTenant, (req, res, next) => slotController.getSlots(req, res, next));

export default router;
