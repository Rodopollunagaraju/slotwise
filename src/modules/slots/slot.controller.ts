import { Request, Response, NextFunction } from 'express';
import { slotService } from './slot.service';

export class SlotController {
  async getSlots(req: Request, res: Response, next: NextFunction): Promise<any> {
    try {
      const tenantId = req.tenant!.id;
      const { serviceId, date, staffId, slotIntervalMin } = req.query;

      if (!serviceId || !date) {
        return res.status(400).json({
          success: false,
          error: 'VALIDATION_ERROR',
          message: 'serviceId and date (YYYY-MM-DD) are required query parameters.',
        });
      }

      const slots = await slotService.getAvailableSlots(tenantId, {
        serviceId: serviceId as string,
        date: date as string,
        staffId: staffId ? (staffId as string) : undefined,
        slotIntervalMin: slotIntervalMin ? Number(slotIntervalMin) : undefined,
      });

      return res.status(200).json({
        success: true,
        count: slots.length,
        data: slots,
      });
    } catch (err) {
      next(err);
    }
  }
}

export const slotController = new SlotController();
