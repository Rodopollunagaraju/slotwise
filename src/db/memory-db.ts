import { v4 as uuidv4 } from 'uuid';

export interface QueryResult<T = any> {
  rows: T[];
  rowCount: number;
}

export class MemoryDb {
  tenants: any[] = [];
  users: any[] = [];
  services: any[] = [];
  staff: any[] = [];
  staffServices: any[] = [];
  availability: any[] = [];
  timeOff: any[] = [];
  bookings: any[] = [];
  payments: any[] = [];
  outbox: any[] = [];
  idempotencyKeys: any[] = [];
  auditLogs: any[] = [];

  private isLocked = false;
  private lockQueue: (() => void)[] = [];

  async acquireLock(): Promise<() => void> {
    if (!this.isLocked) {
      this.isLocked = true;
      return () => {
        if (this.lockQueue.length > 0) {
          const next = this.lockQueue.shift()!;
          next();
        } else {
          this.isLocked = false;
        }
      };
    }
    return new Promise((resolve) => {
      this.lockQueue.push(() => {
        resolve(() => {
          if (this.lockQueue.length > 0) {
            const next = this.lockQueue.shift()!;
            next();
          } else {
            this.isLocked = false;
          }
        });
      });
    });
  }

  // Double-booking check: equivalent to Postgres EXCLUDE USING gist (staff_id WITH =, tstzrange(start_at, end_at, '[)') WITH &&) WHERE (status IN ('PENDING', 'CONFIRMED'))
  checkExclusionConstraint(staffId: string, startAt: Date, endAt: Date, excludeBookingId?: string): boolean {
    const overlapping = this.bookings.find((b) => {
      if (b.staff_id !== staffId) return false;
      if (excludeBookingId && b.id === excludeBookingId) return false;
      if (b.status !== 'PENDING' && b.status !== 'CONFIRMED') return false;

      const bStart = new Date(b.start_at).getTime();
      const bEnd = new Date(b.end_at).getTime();
      const nStart = new Date(startAt).getTime();
      const nEnd = new Date(endAt).getTime();

      // Range overlap check: [startA, endA) overlaps [startB, endB) iff startA < endB and endA > startB
      return nStart < bEnd && nEnd > bStart;
    });

    return !!overlapping;
  }

  reset() {
    this.tenants = [];
    this.users = [];
    this.services = [];
    this.staff = [];
    this.staffServices = [];
    this.availability = [];
    this.timeOff = [];
    this.bookings = [];
    this.payments = [];
    this.outbox = [];
    this.idempotencyKeys = [];
    this.auditLogs = [];
  }
}

export const memoryDb = new MemoryDb();
