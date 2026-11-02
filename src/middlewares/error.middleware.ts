import { Request, Response, NextFunction } from 'express';

export function errorHandler(err: any, req: Request, res: Response, next: NextFunction): any {
  console.error('[Error Handler]', err);

  // PostgreSQL Exclusion Constraint Violation (Code 23P01)
  if (err.code === '23P01' || (err.message && err.message.includes('exclusion constraint'))) {
    return res.status(409).json({
      success: false,
      error: 'SLOT_ALREADY_BOOKED',
      message: 'This staff member is already booked for this overlapping time slot. Please choose another time or staff.',
    });
  }

  // PostgreSQL Unique Constraint Violation (Code 23505)
  if (err.code === '23505') {
    return res.status(409).json({
      success: false,
      error: 'DUPLICATE_RESOURCE',
      message: 'A record with this identifier already exists.',
    });
  }

  const statusCode = err.statusCode || err.status || 500;
  res.status(statusCode).json({
    success: false,
    error: err.name || 'INTERNAL_SERVER_ERROR',
    message: err.message || 'An unexpected server error occurred.',
  });
}
