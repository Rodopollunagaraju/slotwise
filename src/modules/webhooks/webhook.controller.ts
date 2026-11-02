import { Request, Response, NextFunction } from 'express';
import { webhookService } from './webhook.service';

export class WebhookController {
  async handleStripe(req: Request, res: Response, next: NextFunction): Promise<any> {
    try {
      const signature = req.headers['stripe-signature'] as string;
      const rawBody = (req as any).rawBody || JSON.stringify(req.body);

      // Verify signature in production or if signature is passed
      if (signature && !webhookService.verifyStripeSignature(rawBody, signature)) {
        return res.status(400).json({ success: false, error: 'INVALID_SIGNATURE' });
      }

      const event = req.body;
      if (event.type === 'payment_intent.succeeded') {
        const paymentIntent = event.data?.object;
        const eventId = event.id || `evt_${Date.now()}`;
        const orderId = paymentIntent.id;
        const paymentId = paymentIntent.latest_charge || paymentIntent.id;

        await webhookService.handlePaymentSuccess('STRIPE', eventId, orderId, paymentId);
      }

      return res.status(200).json({ received: true });
    } catch (err) {
      next(err);
    }
  }

  async handleRazorpay(req: Request, res: Response, next: NextFunction): Promise<any> {
    try {
      const signature = req.headers['x-razorpay-signature'] as string;
      const rawBody = (req as any).rawBody || JSON.stringify(req.body);

      if (signature && !webhookService.verifyRazorpaySignature(rawBody, signature)) {
        return res.status(400).json({ success: false, error: 'INVALID_SIGNATURE' });
      }

      const event = req.body;
      if (event.event === 'order.paid' || event.event === 'payment.captured') {
        const payload = event.payload?.payment?.entity || event.payload?.order?.entity;
        const eventId = event.event_id || `rzp_evt_${Date.now()}`;
        const orderId = payload.order_id || payload.id;
        const paymentId = payload.id;

        await webhookService.handlePaymentSuccess('RAZORPAY', eventId, orderId, paymentId);
      }

      return res.status(200).json({ status: 'ok' });
    } catch (err) {
      next(err);
    }
  }
}

export const webhookController = new WebhookController();
