import { Request, Response, NextFunction } from 'express';
import { paymentService } from './payment.service';

export class PaymentController {
  async createOrder(req: Request, res: Response, next: NextFunction): Promise<any> {
    try {
      const tenantId = req.tenant!.id;
      const { bookingId, provider = 'STRIPE' } = req.body;

      if (!bookingId) {
        return res.status(400).json({
          success: false,
          error: 'VALIDATION_ERROR',
          message: 'bookingId is required.',
        });
      }

      if (provider !== 'STRIPE' && provider !== 'RAZORPAY') {
        return res.status(400).json({
          success: false,
          error: 'INVALID_PROVIDER',
          message: "provider must be either 'STRIPE' or 'RAZORPAY'.",
        });
      }

      const order = await paymentService.createPaymentOrder(tenantId, bookingId, provider);
      return res.status(201).json({ success: true, data: order });
    } catch (err) {
      next(err);
    }
  }
}

export const paymentController = new PaymentController();
