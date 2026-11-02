import { Router } from 'express';
import { authController } from './auth.controller';
import { authenticate } from '../../middlewares/auth.middleware';

const router = Router();

router.post('/register-tenant', (req, res, next) => authController.registerTenant(req, res, next));
router.post('/register-customer', (req, res, next) => authController.registerCustomer(req, res, next));
router.post('/login', (req, res, next) => authController.login(req, res, next));
router.get('/me', authenticate, (req, res) => authController.me(req, res));

export default router;
