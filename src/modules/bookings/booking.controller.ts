import { Request, Response, NextFunction } from 'express';
import { bookingService } from './booking.service';

export class BookingController {
  async create(req: Request, res: Response, next: NextFunction): Promise<any> {
    try {
      const tenantId = req.tenant!.id;
      const { serviceId, staffId, startAt, customerName, customerEmail, customerPhone, notes } = req.body;

      if (!serviceId || !staffId || !startAt || !customerName || !customerEmail) {
        return res.status(400).json({
          success: false,
          error: 'VALIDATION_ERROR',
          message: 'serviceId, staffId, startAt, customerName, and customerEmail are required.',
        });
      }

      const booking = await bookingService.createBooking(tenantId, {
        serviceId,
        staffId,
        startAt,
        customerName,
        customerEmail,
        customerPhone,
        notes,
        customerId: req.user?.id,
      });

      return res.status(201).json({
        success: true,
        data: booking,
      });
    } catch (err) {
      next(err);
    }
  }

  async getById(req: Request, res: Response, next: NextFunction): Promise<any> {
    try {
      const tenantId = req.tenant!.id;
      const booking = await bookingService.getBookingById(tenantId, req.params.id);
      return res.status(200).json({ success: true, data: booking });
    } catch (err) {
      next(err);
    }
  }

  async list(req: Request, res: Response, next: NextFunction): Promise<any> {
    try {
      const tenantId = req.tenant!.id;
      const { staffId, status } = req.query;

      let customerId: string | undefined;
      // If customer role, restrict to viewing own bookings
      if (req.user?.role === 'CUSTOMER') {
        customerId = req.user.id;
      }

      const bookings = await bookingService.listBookings(tenantId, {
        staffId: staffId as string,
        status: status as string,
        customerId,
      });

      return res.status(200).json({ success: true, data: bookings });
    } catch (err) {
      next(err);
    }
  }

  async cancel(req: Request, res: Response, next: NextFunction): Promise<any> {
    try {
      const tenantId = req.tenant!.id;
      const { reason } = req.body;
      const result = await bookingService.cancelBooking(tenantId, req.params.id, reason);
      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }

  async reschedule(req: Request, res: Response, next: NextFunction): Promise<any> {
    try {
      const tenantId = req.tenant!.id;
      const { newStartAt } = req.body;
      if (!newStartAt) {
        return res.status(400).json({
          success: false,
          error: 'VALIDATION_ERROR',
          message: 'newStartAt is required.',
        });
      }

      const booking = await bookingService.rescheduleBooking(tenantId, req.params.id, newStartAt);
      return res.status(200).json({ success: true, data: booking });
    } catch (err) {
      next(err);
    }
  }
}

export const bookingController = new BookingController();
