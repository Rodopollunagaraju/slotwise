/**
 * ============================================================================
 * SlotWise — Email Notification Service & Resilient Circuit Breaker
 * ============================================================================
 * 
 * ARCHITECTURAL DESIGN PATTERNS:
 * 
 * 1. CIRCUIT BREAKER PATTERN FOR THIRD-PARTY EMAIL APIS:
 *    Problem:
 *    When integrating third-party email providers (Resend, SendGrid, Amazon SES),
 *    transient network partitions or cloud provider outages can cause outbound
 *    HTTP calls to hang until a 30-second socket timeout. If 1,000 notifications
 *    are enqueued, workers exhaust all available sockets and thread pool capacity,
 *    causing cascading failure across the entire backend.
 * 
 *    Solution (Circuit Breaker State Machine):
 *    - CLOSED (Healthy): All email dispatch calls proceed normally.
 *    - OPEN (Tripped): After 3 consecutive failures, the breaker trips. Subsequent
 *      email requests fail FAST immediately (0ms) without hitting the network,
 *      allowing workers to divert jobs or retry later without socket exhaustion.
 *    - HALF-OPEN (Testing): After a 10-second cooldown, one probe request is allowed
 *      through. If it succeeds, the breaker resets to CLOSED; if it fails, it returns
 *      to OPEN.
 * 
 * 2. TRANSACTIONAL EMAIL TEMPLATES:
 *    - Booking Confirmation (with calendar details & deposit receipt)
 *    - 24-Hour Prior Appointment Reminder
 *    - Cancellation & Refund Notice
 */

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export class EmailService {
  // Circuit breaker state
  private circuitState: CircuitState = 'CLOSED';
  private failureCount = 0;
  private readonly failureThreshold = 3;
  private readonly resetTimeoutMs = 10000;
  private nextAttemptTime = 0;

  // Sent emails log for testing and auditing
  public sentEmails: Array<EmailMessage & { timestamp: string }> = [];

  getCircuitState(): CircuitState {
    return this.circuitState;
  }

  /**
   * Resets circuit breaker (primarily used in testing).
   */
  resetCircuitBreaker() {
    this.circuitState = 'CLOSED';
    this.failureCount = 0;
    this.nextAttemptTime = 0;
  }

  /**
   * Dispatches email through circuit-breaker protected transport.
   */
  async sendEmail(msg: EmailMessage, simulateFailure = false): Promise<{ success: boolean; messageId: string }> {
    const now = Date.now();

    // Check circuit breaker status
    if (this.circuitState === 'OPEN') {
      if (now > this.nextAttemptTime) {
        this.circuitState = 'HALF_OPEN';
        console.log('[EmailService] Circuit Breaker transitioned to HALF-OPEN (testing provider health)');
      } else {
        throw new Error('[EmailService:CircuitBreaker] Breaker is OPEN. Email delivery temporarily throttled.');
      }
    }

    try {
      if (simulateFailure) {
        throw new Error('Simulated upstream email provider timeout/500');
      }

      // Record successful simulated email dispatch
      this.sentEmails.push({
        ...msg,
        timestamp: new Date().toISOString(),
      });

      console.log(`[EmailService] Dispatched email to: ${msg.to} | Subject: "${msg.subject}"`);

      // Reset on success if in HALF_OPEN
      if (this.circuitState === 'HALF_OPEN') {
        console.log('[EmailService] Circuit Breaker recovered to CLOSED');
        this.circuitState = 'CLOSED';
        this.failureCount = 0;
      }

      return { success: true, messageId: `msg_${Date.now()}` };
    } catch (err: any) {
      this.failureCount++;
      console.error(`[EmailService] Email dispatch failed (attempt ${this.failureCount}/${this.failureThreshold}):`, err.message);

      if (this.failureCount >= this.failureThreshold) {
        this.circuitState = 'OPEN';
        this.nextAttemptTime = Date.now() + this.resetTimeoutMs;
        console.warn(`[EmailService] Circuit Breaker TRIPPED to OPEN for next ${this.resetTimeoutMs / 1000}s.`);
      }

      throw err;
    }
  }

  /**
   * Template: Booking Confirmation
   */
  generateBookingConfirmationEmail(data: {
    customerName: string;
    customerEmail: string;
    serviceName: string;
    staffName: string;
    startAt: string;
    depositAmount: number;
    salonName: string;
  }): EmailMessage {
    const dateStr = new Date(data.startAt).toLocaleString('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'UTC',
    });

    return {
      to: data.customerEmail,
      subject: `Your Appointment at ${data.salonName} is Confirmed!`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
          <h2 style="color: #4f46e5;">Appointment Confirmed!</h2>
          <p>Hi <strong>${data.customerName}</strong>,</p>
          <p>Your appointment at <strong>${data.salonName}</strong> has been successfully booked and confirmed.</p>
          <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
            <tr style="border-bottom: 1px solid #e2e8f0;"><td style="padding: 8px 0; color: #64748b;">Service:</td><td style="font-weight: bold;">${data.serviceName}</td></tr>
            <tr style="border-bottom: 1px solid #e2e8f0;"><td style="padding: 8px 0; color: #64748b;">Stylist:</td><td style="font-weight: bold;">${data.staffName}</td></tr>
            <tr style="border-bottom: 1px solid #e2e8f0;"><td style="padding: 8px 0; color: #64748b;">Date & Time:</td><td style="font-weight: bold;">${dateStr} UTC</td></tr>
            <tr style="border-bottom: 1px solid #e2e8f0;"><td style="padding: 8px 0; color: #64748b;">Deposit Paid:</td><td style="font-weight: bold; color: #16a34a;">$${data.depositAmount.toFixed(2)}</td></tr>
          </table>
          <p style="color: #64748b; font-size: 13px;">Need to cancel or reschedule? Please notify us at least 24 hours prior to qualify for a full deposit refund.</p>
        </div>
      `,
      text: `Appointment Confirmed! Hi ${data.customerName}, your appointment for ${data.serviceName} with ${data.staffName} on ${dateStr} is confirmed. Deposit paid: $${data.depositAmount}.`,
    };
  }

  /**
   * Template: 24-Hour Prior Reminder
   */
  generate24hReminderEmail(data: {
    customerName: string;
    customerEmail: string;
    serviceName: string;
    staffName: string;
    startAt: string;
    salonName: string;
  }): EmailMessage {
    const dateStr = new Date(data.startAt).toLocaleString('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'UTC',
    });

    return {
      to: data.customerEmail,
      subject: `Reminder: Your Appointment Tomorrow at ${data.salonName}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
          <h2 style="color: #0284c7;">See You Tomorrow!</h2>
          <p>Hi <strong>${data.customerName}</strong>,</p>
          <p>This is a friendly reminder for your upcoming session tomorrow at <strong>${data.salonName}</strong>.</p>
          <p><strong>Service:</strong> ${data.serviceName}<br/><strong>Stylist:</strong> ${data.staffName}<br/><strong>Time:</strong> ${dateStr} UTC</p>
          <p style="color: #64748b; font-size: 13px;">Please arrive 5-10 minutes prior to your scheduled time.</p>
        </div>
      `,
      text: `Reminder: Your appointment for ${data.serviceName} with ${data.staffName} at ${data.salonName} is tomorrow at ${dateStr}.`,
    };
  }

  /**
   * Template: Booking Cancellation
   */
  generateCancellationEmail(data: {
    customerName: string;
    customerEmail: string;
    serviceName: string;
    refundNotice: string;
    salonName: string;
  }): EmailMessage {
    return {
      to: data.customerEmail,
      subject: `Appointment Cancelled — ${data.salonName}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
          <h2 style="color: #dc2626;">Appointment Cancelled</h2>
          <p>Hi <strong>${data.customerName}</strong>,</p>
          <p>Your appointment for <strong>${data.serviceName}</strong> at <strong>${data.salonName}</strong> has been cancelled.</p>
          <p style="background: #f8fafc; padding: 12px; border-radius: 6px; font-weight: 500;">${data.refundNotice}</p>
        </div>
      `,
      text: `Appointment Cancelled: Hi ${data.customerName}, your appointment for ${data.serviceName} has been cancelled. Notice: ${data.refundNotice}`,
    };
  }
}

export const emailService = new EmailService();

