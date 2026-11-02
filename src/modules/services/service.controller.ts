import { Request, Response, NextFunction } from 'express';
import { serviceService } from './service.service';

export class ServiceController {
  async list(req: Request, res: Response, next: NextFunction): Promise<any> {
    try {
      const tenantId = req.tenant!.id;
      const services = await serviceService.listServices(tenantId);
      return res.status(200).json({ success: true, data: services });
    } catch (err) {
      next(err);
    }
  }

  async getById(req: Request, res: Response, next: NextFunction): Promise<any> {
    try {
      const tenantId = req.tenant!.id;
      const service = await serviceService.getServiceById(tenantId, req.params.id);
      return res.status(200).json({ success: true, data: service });
    } catch (err) {
      next(err);
    }
  }

  async create(req: Request, res: Response, next: NextFunction): Promise<any> {
    try {
      const tenantId = req.tenant!.id;
      const { name, description, durationMin, price, depositAmount, bufferAfterMin } = req.body;
      if (!name || !durationMin || price === undefined) {
        return res.status(400).json({
          success: false,
          error: 'VALIDATION_ERROR',
          message: 'name, durationMin, and price are required.',
        });
      }

      const service = await serviceService.createService(tenantId, {
        name,
        description,
        durationMin: Number(durationMin),
        price: Number(price),
        depositAmount: depositAmount ? Number(depositAmount) : 0,
        bufferAfterMin: bufferAfterMin ? Number(bufferAfterMin) : 0,
      });

      return res.status(201).json({ success: true, data: service });
    } catch (err) {
      next(err);
    }
  }

  async delete(req: Request, res: Response, next: NextFunction): Promise<any> {
    try {
      const tenantId = req.tenant!.id;
      const result = await serviceService.deleteService(tenantId, req.params.id);
      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
}

export const serviceController = new ServiceController();
