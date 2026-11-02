import { Request, Response, NextFunction } from 'express';
import { staffService } from './staff.service';

export class StaffController {
  async list(req: Request, res: Response, next: NextFunction): Promise<any> {
    try {
      const tenantId = req.tenant!.id;
      const staffList = await staffService.listStaff(tenantId);
      return res.status(200).json({ success: true, data: staffList });
    } catch (err) {
      next(err);
    }
  }

  async getById(req: Request, res: Response, next: NextFunction): Promise<any> {
    try {
      const tenantId = req.tenant!.id;
      const staff = await staffService.getStaffById(tenantId, req.params.id);
      return res.status(200).json({ success: true, data: staff });
    } catch (err) {
      next(err);
    }
  }

  async create(req: Request, res: Response, next: NextFunction): Promise<any> {
    try {
      const tenantId = req.tenant!.id;
      const { name, email, password, phone, bio, serviceIds } = req.body;
      if (!name || !email) {
        return res.status(400).json({
          success: false,
          error: 'VALIDATION_ERROR',
          message: 'name and email are required.',
        });
      }

      const staff = await staffService.createStaff(tenantId, {
        name,
        email,
        password,
        phone,
        bio,
        serviceIds,
      });

      return res.status(201).json({ success: true, data: staff });
    } catch (err) {
      next(err);
    }
  }

  async assignService(req: Request, res: Response, next: NextFunction): Promise<any> {
    try {
      const tenantId = req.tenant!.id;
      const { serviceId, customDurationMin, customPrice } = req.body;
      if (!serviceId) {
        return res.status(400).json({
          success: false,
          error: 'VALIDATION_ERROR',
          message: 'serviceId is required.',
        });
      }

      const result = await staffService.assignService(
        tenantId,
        req.params.id,
        serviceId,
        customDurationMin ? Number(customDurationMin) : undefined,
        customPrice ? Number(customPrice) : undefined
      );

      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
}

export const staffController = new StaffController();
