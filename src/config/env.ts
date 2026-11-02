import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '4000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL || 'postgres://slotwise_user:slotwise_secret@localhost:5432/slotwise_db',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  jwtSecret: process.env.JWT_SECRET || 'super_secure_slotwise_jwt_secret_key_12345',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || 'sk_test_mock_slotwise_key',
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || 'whsec_mock_stripe_webhook_secret',
  razorpayKeyId: process.env.RAZORPAY_KEY_ID || 'rzp_test_mock_slotwise_id',
  razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET || 'rzp_mock_slotwise_secret',
  razorpayWebhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || 'whsec_mock_razorpay_secret',
  pendingBookingExpiryMinutes: parseInt(process.env.PENDING_BOOKING_EXPIRY_MINUTES || '15', 10),
  cancellationWindowHours: parseInt(process.env.CANCELLATION_WINDOW_HOURS || '24', 10),
};
