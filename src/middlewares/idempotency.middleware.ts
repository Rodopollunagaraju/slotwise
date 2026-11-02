import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { db } from '../config/database';

export async function idempotencyMiddleware(req: Request, res: Response, next: NextFunction): Promise<any> {
  const idempotencyKey = req.headers['idempotency-key'] as string;
  if (!idempotencyKey) {
    return next();
  }

  const tenantId = req.tenant?.id;
  if (!tenantId) {
    return next();
  }

  // Generate hash of the request body and method/url
  const requestPayload = JSON.stringify(req.body || {});
  const requestHash = crypto.createHash('sha256').update(`${req.method}:${req.originalUrl}:${requestPayload}`).digest('hex');

  try {
    const existing = await db.query(
      'SELECT * FROM idempotency_keys WHERE key = $1 AND tenant_id = $2',
      [idempotencyKey, tenantId]
    );

    if (existing.rows.length > 0) {
      const record = existing.rows[0];

      // If already finished, return cached response directly
      if (record.status === 'COMPLETED') {
        res.setHeader('X-Cache-Lookup', 'HIT');
        res.setHeader('Idempotency-Key-Status', 'CACHED');
        return res.status(record.response_status).json(record.response_body);
      }

      // If still processing, return conflict to avoid concurrent duplicate execution
      if (record.status === 'PROCESSING') {
        return res.status(409).json({
          success: false,
          error: 'IDEMPOTENCY_CONFLICT',
          message: 'An identical operation is currently being processed. Please wait and retry.',
        });
      }
    }

    // Insert record in PROCESSING state
    await db.query(
      `INSERT INTO idempotency_keys (key, tenant_id, user_id, request_hash, status, expires_at)
       VALUES ($1, $2, $3, $4, 'PROCESSING', NOW() + INTERVAL '24 hours')
       ON CONFLICT (key) DO NOTHING`,
      [idempotencyKey, tenantId, req.user?.id || null, requestHash]
    );

    // Intercept res.json to capture response
    const originalJson = res.json.bind(res);
    res.json = (body: any): any => {
      // Async update idempotency key with completed status and response
      db.query(
        `UPDATE idempotency_keys
         SET status = 'COMPLETED', response_status = $1, response_body = $2
         WHERE key = $3`,
        [res.statusCode, JSON.stringify(body), idempotencyKey]
      ).catch((err) => {
        console.error('[Idempotency] Failed to save completed response:', err);
      });

      return originalJson(body);
    };

    next();
  } catch (err: any) {
    console.error('[Idempotency] Error checking key:', err);
    next(err);
  }
}
