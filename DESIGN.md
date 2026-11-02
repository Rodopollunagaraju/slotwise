# SlotWise — System Design Document (DESIGN.md)

## 1. System Overview & Problem Statement
SlotWise is a high-reliability, multi-tenant SaaS booking platform engineered for salons, spas, and appointment-based services. In salon scheduling systems, concurrent booking attempts for high-demand stylists or popular holiday time slots frequently create catastrophic **double-booking race conditions** in naive architectures. 

SlotWise eliminates double-booking through a **database-level exclusion constraint** (`EXCLUDE USING gist`) in PostgreSQL, combined with a **transactional outbox pattern**, **request-level idempotency**, and **strict tenant isolation**.

---

## 2. Architecture Diagram

```
                              [ Client / Mobile App ]
                                         │
                   Subdomain: glamsalon.slotwise.com (or X-Tenant-Slug)
                                         │
                                         ▼
                            [ Nginx Gateway & Proxy ]
                 (SSL Termination, Rate Limiting, Micro-cache)
                                         │
                   ┌─────────────────────┼─────────────────────┐
                   ▼                     ▼                     ▼
             [ API Node 1 ]        [ API Node 2 ]        [ API Node 3 ]
             (Stateless)           (Stateless)           (Stateless)
                   │                     │                     │
                   ├─────────────────────┴─────────────────────┤
                   ▼                                           ▼
          [ Redis Cluster ]                          [ PgBouncer Pool ]
      (Cache-aside & Idempotency)                              │
                                                               ▼
                                                     [ PostgreSQL 16 ]
                                                     - btree_gist extension
                                                     - Exclusion Constraints
                                                     - Outbox Table
                                                               │
                                                               ▼
                                                     [ Outbox Worker ]
                                                               │
                                                               ▼
                                                     [ Email / BullMQ ]
```

---

## 3. Key Architectural Decisions & Trade-offs

### Decision 1: Database-Level Exclusion Constraint vs. Application-Level Locking
* **Naive Approach (`SELECT FOR UPDATE`)**: 
  - Application checks if an overlapping slot exists: `SELECT * FROM bookings WHERE staff_id = $1 AND range && ... FOR UPDATE;`
  - *Failure mode*: If no row exists yet for the new slot, there is no row for `SELECT FOR UPDATE` to lock! Two concurrent transactions both execute `SELECT`, both see 0 rows, and both commit `INSERT`. Result: double booking.
  - *Serializing via staff table lock*: Locking the entire staff record (`SELECT * FROM staff WHERE id = $1 FOR UPDATE`) serializes all booking attempts across the entire day for that staff member, degrading throughput from 500+ req/s to single digits.
* **SlotWise Approach (`EXCLUDE USING gist`)**:
  ```sql
  CONSTRAINT no_overlapping_staff_bookings EXCLUDE USING gist (
      staff_id WITH =,
      tstzrange(start_at, end_at, '[)') WITH &&
  ) WHERE (status IN ('PENDING', 'CONFIRMED'));
  ```
  - PostgreSQL's GiST index evaluates temporal range overlap (`&&`) at the engine level with serializable atomicity.
  - If a concurrent write conflicts, PostgreSQL immediately throws error code `23P01` (`exclusion_violation`).
  - Application catches `23P01` and cleanly returns `409 Conflict: SLOT_ALREADY_BOOKED`.
  - Non-conflicting slots for the same staff member execute fully in parallel without artificial serialization!

### Decision 2: Multi-Tenancy Architecture (Shared Database, Pooled Schema)
* **Model**: Shared database with `tenant_id` on every table.
* **Tenant Isolation Guardrails**:
  1. Tenant slug is derived strictly from request context (subdomain `salon.slotwise.com` or header `X-Tenant-Slug`), **never** from request body.
  2. Every database query enforces `WHERE tenant_id = $tenantId`.
  3. JWT authentication embeds `tenantId`. If a user attempts to send requests to `salon-b.slotwise.com` with a token issued for `salon-a`, the auth middleware rejects with `403 CROSS_TENANT_ACCESS_DENIED`.

### Decision 3: Transactional Outbox Pattern
* To ensure email confirmations and payment capture notifications are never lost if the external network/email API fails, SlotWise writes the notification payload to the `outbox` table in the **exact same ACID transaction** as the booking insertion:
  ```ts
  await client.query('INSERT INTO bookings ...');
  await client.query('INSERT INTO outbox ...');
  // Both commit atomically or both roll back!
  ```
* A background relay worker reads `outbox` where `status = 'PENDING'`, dispatches to the message queue, and marks `status = 'PUBLISHED'`.

### Decision 4: Webhook & Payment Idempotency
* Third-party payment gateways (Stripe / Razorpay) guarantee *at least once* webhook delivery, which can trigger duplicate booking confirmation events.
* SlotWise verifies HMAC SHA256 signatures (`stripe-signature` and `x-razorpay-signature`) and records `webhook:{provider}:{eventId}` into `idempotency_keys` in an atomic transaction before updating booking status.
* Replayed or duplicate webhooks return `200 OK` immediately without re-executing business logic.

---

## 4. Booking State Machine

```
               [ Customer Submits Slot ]
                          │
                          ▼
                     ( PENDING ) ──[ Unpaid 15m Timeout ]──► ( EXPIRED )
                          │                                   (Slot released)
                [ Deposit Webhook Paid ]
                          │
                          ▼
                    ( CONFIRMED )
                     │         │
    [ Completed By ] │         │ [ Customer Cancels ]
        [ Staff ]    │         │
                     ▼         ▼
               ( COMPLETED ) ( CANCELLED )
                              (Slot released; refund checked)
```

---

## 5. Capacity & Load Estimation (100x Scale)

| Metric | Target (Current) | At 100x Scale | Scaling Strategy |
| :--- | :--- | :--- | :--- |
| **Active Salons** | 50 | 5,000 | Multi-tenant sharding / tenant-level schema partitioning |
| **Daily Bookings** | 5,000 | 500,000 | PgBouncer transaction pooling + Read Replicas for `/slots` |
| **Peak Concurrency**| 100 req/s | 10,000 req/s | Redis cache-aside for availability windows + Redis distributed lock |
| **Database Connections** | 20 | 1,000+ | PgBouncer running in `transaction` mode |
| **Storage Growth** | ~1 GB/month | ~100 GB/month | PostgreSQL table partitioning by `(tenant_id, date)` + cold storage archival |
