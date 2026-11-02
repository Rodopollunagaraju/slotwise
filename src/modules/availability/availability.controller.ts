import { Request, Response, NextFunction } from 'express';
import { availabilityService } from './availability.service';

export class AvailabilityController {
  async setWorkingHours(req: Request, res: Response, next: NextFunction): Promise<any> {
    try {
      const tenantId = req.tenant!.id;
      const { staffId, schedule } = req.body;
      if (!staffId || !Array.isArray(schedule)) {
        return res.status(400).json({
          success: false,
          error: 'VALIDATION_ERROR',
          message: 'staffId and schedule array are required.',
        });
      }

      const result = await availabilityService.setWorkingHours(tenantId, staffId, schedule);
      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }

  async getStaffSchedule(req: Request, res: Response, next: NextFunction): Promise<any> {
    try {
      const tenantId = req.tenant!.id;
      const schedule = await availabilityService.getStaffSchedule(tenantId, req.params.staffId);
      return res.status(200).json({ success: true, data: schedule });
    } catch (err) {
      next(err);
    }
  }

  async addTimeOff(req: Request, res: Response, next: NextFunction): Promise<any> {
    try {
      const tenantId = req.tenant!.id;
      const { staffId, startDate, endDate, reason } = req.body;
      if (!staffId || !startDate || !endDate) {
        return res.status(400).json({
          success: false,
          error: 'VALIDATION_ERROR',
          message: 'staffId, startDate, and endDate are required.',
        });
      }

      const timeOff = await availabilityService.addTimeOff(tenantId, staffId, startDate, endDate, reason);
      return res.status(201).json({ success: true, data: timeOff });
    } catch (err) {
      next(err);
    }
  }

  async getStaffTimeOff(req: Request, res: Response, next: NextFunction): Promise<any> {
    try {
      const tenantId = req.tenant!.id;
      const timeOff = await availabilityService.getStaffTimeOff(tenantId, req.params.staffId);
      return res.status(200).json({ success: true, data: timeOff });
    } catch (err) {
      next(err);
    }
  }
}

export const availabilityController = new AvailabilityController();
