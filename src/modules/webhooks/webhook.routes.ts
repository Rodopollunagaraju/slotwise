import { Router } from 'express';
import { webhookController } from './webhook.controller';

const router = Router();

router.post('/stripe', (req, res, next) => webhookController.handleStripe(req, res, next));
router.post('/razorpay', (req, res, next) => webhookController.handleRazorpay(req, res, next));

export default router;
