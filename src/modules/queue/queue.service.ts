/**
 * ============================================================================
 * SlotWise — Asynchronous Job Queue with Exponential Backoff & DLQ
 * ============================================================================
 * 
 * ARCHITECTURAL ROLE:
 * Provides background processing for operations that should not block the
 * HTTP request-response cycle (e.g., sending emails, SMS reminders, syncing
 * webhooks, generating analytics reports).
 * 
 * CORE RELIABILITY PATTERNS:
 * 
 * 1. EXPONENTIAL BACKOFF RETRIES WITH JITTER:
 *    When a worker encounters a transient error (such as email service 503 or
 *    network timeout), immediately retrying can overwhelm the recovering service.
 *    Instead, the retry delay grows exponentially:
 *    - Attempt 1: immediate
 *    - Attempt 2: 2 seconds
 *    - Attempt 3: 4 seconds
 * 
 * 2. DEAD-LETTER QUEUE (DLQ):
 *    If a job exhausts all allowed retry attempts (default: 3), it is not
 *    silently discarded. It is routed to the Dead-Letter Queue with its full
 *    payload, stack trace, and timestamps. System administrators can inspect,
 *    diagnose, and re-drive DLQ jobs via admin tooling.
 * 
 * 3. DELAYED JOB SCHEDULING (BULLMQ COMPATIBLE):
 *    Jobs can be scheduled to run at a specific future millisecond timestamp,
 *    such as sending an appointment reminder 24 hours prior to booking start time.
 */

import { emailService, EmailMessage } from '../notifications/email.service';

export interface Job<T = any> {
  id: string;
  name: string;
  data: T;
  priority?: 'HIGH' | 'DEFAULT' | 'LOW';
  attempts: number;
  maxAttempts: number;
  delayMs?: number;
  runAt: number; // Milliseconds timestamp
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'DLQ';
  lastError?: string;
  createdAt: number;
  completedAt?: number;
}

export class QueueService {
  private queue: Job[] = [];
  private dlq: Job[] = [];
  private timer: NodeJS.Timeout | null = null;
  private isProcessing = false;

  /**
   * Enqueues an immediate or delayed job.
   */
  async add<T>(
    name: string,
    data: T,
    options: {
      priority?: 'HIGH' | 'DEFAULT' | 'LOW';
      delayMs?: number;
      maxAttempts?: number;
    } = {}
  ): Promise<Job<T>> {
    const { priority = 'DEFAULT', delayMs = 0, maxAttempts = 3 } = options;
    const now = Date.now();

    const job: Job<T> = {
      id: `job_${now}_${Math.random().toString(36).substring(2, 8)}`,
      name,
      data,
      priority,
      attempts: 0,
      maxAttempts,
      delayMs,
      runAt: now + delayMs,
      status: 'PENDING',
      createdAt: now,
    };

    this.queue.push(job);

    // Sort queue: higher priority first, then earliest runAt
    this.sortQueue();

    return job;
  }

  /**
   * Sorts queue by priority and run time.
   */
  private sortQueue() {
    const priorityWeight = { HIGH: 3, DEFAULT: 2, LOW: 1 };
    this.queue.sort((a, b) => {
      const pDiff = (priorityWeight[b.priority || 'DEFAULT'] || 2) - (priorityWeight[a.priority || 'DEFAULT'] || 2);
      if (pDiff !== 0) return pDiff;
      return a.runAt - b.runAt;
    });
  }

  /**
   * Processes ready jobs in the queue.
   */
  async processJobs(): Promise<{ processed: number; failures: number }> {
    if (this.isProcessing) return { processed: 0, failures: 0 };
    this.isProcessing = true;

    let processed = 0;
    let failures = 0;
    const now = Date.now();

    // Find jobs that are due to execute
    const readyIndices: number[] = [];
    for (let i = 0; i < this.queue.length; i++) {
      const j = this.queue[i];
      if (j.status === 'PENDING' && j.runAt <= now) {
        readyIndices.push(i);
      }
    }

    for (const idx of readyIndices) {
      const job = this.queue[idx];
      if (!job) continue;

      job.status = 'PROCESSING';
      job.attempts++;

      try {
        await this.executeJobHandler(job);
        job.status = 'COMPLETED';
        job.completedAt = Date.now();
        processed++;
      } catch (err: any) {
        job.lastError = err.message || String(err);
        failures++;

        if (job.attempts >= job.maxAttempts) {
          // Exhausted all retries: Move to Dead-Letter Queue
          job.status = 'DLQ';
          this.dlq.push({ ...job });
          console.error(`[QueueService] Job ${job.id} (${job.name}) moved to DLQ after ${job.attempts} attempts. Error: ${job.lastError}`);
        } else {
          // Exponential backoff: 2s, 4s, 8s with jitter
          const backoffDelay = Math.pow(2, job.attempts) * 1000 + Math.floor(Math.random() * 500);
          job.status = 'PENDING';
          job.runAt = Date.now() + backoffDelay;
          console.warn(`[QueueService] Job ${job.id} failed (attempt ${job.attempts}/${job.maxAttempts}). Retrying in ${backoffDelay}ms.`);
        }
      }
    }

    // Clean out completed or DLQ jobs from active queue
    this.queue = this.queue.filter((j) => j.status === 'PENDING');
    this.isProcessing = false;

    return { processed, failures };
  }

  /**
   * Executes job logic based on job name.
   */
  private async executeJobHandler(job: Job) {
    switch (job.name) {
      case 'send-booking-confirmation': {
        const emailMsg = emailService.generateBookingConfirmationEmail(job.data);
        await emailService.sendEmail(emailMsg);
        break;
      }
      case 'send-24h-reminder': {
        const emailMsg = emailService.generate24hReminderEmail(job.data);
        await emailService.sendEmail(emailMsg);
        break;
      }
      case 'send-cancellation-notice': {
        const emailMsg = emailService.generateCancellationEmail(job.data);
        await emailService.sendEmail(emailMsg);
        break;
      }
      default:
        console.log(`[QueueService] Executed generic job: ${job.name}`);
    }
  }

  /**
   * Starts background worker polling loop.
   */
  start(intervalMs = 1000) {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.processJobs().catch((err) => {
        console.error('[QueueService] Error in job processing loop:', err);
      });
    }, intervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getQueueSnapshot() {
    return {
      activeLength: this.queue.length,
      dlqLength: this.dlq.length,
      dlq: [...this.dlq],
    };
  }

  clear() {
    this.queue = [];
    this.dlq = [];
  }
}

export const queueService = new QueueService();

