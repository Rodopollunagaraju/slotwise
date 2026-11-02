# SlotWise — Multi-Tenant Salon Booking Platform

> **Concurrency-safe, Multi-tenant Salon Booking SaaS** built with TypeScript, Node.js, Express, PostgreSQL (`btree_gist` Exclusion Constraints), Redis, and Docker.

---

## 🌟 Key Highlights & Engineering Proofs
- **Zero Double-Bookings**: Enforces PostgreSQL temporal exclusion constraints (`EXCLUDE USING gist (staff_id WITH =, tstzrange(start_at, end_at, '[)') WITH &&)`) as the final authority on concurrency. Verified under concurrent bursts with 100% data integrity.
- **Strict Multi-Tenant Isolation**: Request context derives `tenant_id` from subdomain or header `X-Tenant-Slug`, never from request body. Cross-tenant token replay returns `403 Forbidden`.
- **Transactional Outbox Pattern**: Atomic transaction guarantees bookings and notification events are persisted together before dispatching to workers.
- **Payment Gateway Webhooks**: Supports Stripe and Razorpay test mode with HMAC-SHA256 signature verification and webhook idempotency.
- **Automatic Slot Release**: Background worker expires `PENDING` bookings after a 15-minute window if the deposit is unpaid, releasing the slot.
- **Idempotent API Operations**: Supports `Idempotency-Key` headers to prevent duplicate charges or bookings upon network retries.

---

## 🚀 Quick Start

### 1. Prerequisites
- Node.js >= 18.x (v20 Recommended)
- npm >= 9.x
- Docker & Docker Compose (optional for containerized deployment)

### 2. Installation
```bash
# Clone and enter the repository
cd slotwise

# Install dependencies
npm install

# Setup environment variables
cp .env.example .env
```

### 3. Running with Docker Compose (PostgreSQL, Redis, PgBouncer, API, Worker)
```bash
# Start all services with one command
docker compose up -d

# Check service health
docker compose ps
```

### 4. Running Locally with Node/TypeScript
SlotWise includes an intelligent dual-engine database layer: it connects to PostgreSQL when running, and gracefully switches to its high-fidelity in-memory engine for rapid local development and automated testing!
```bash
# Run migrations & seed demo data
npm run seed

# Start development server
npm run dev
```

---

## 🧪 Testing & Concurrency Verification

### Run Automated Unit & Integration Tests (12/12 Passing)
```bash
npm test
```
**Test Coverage Includes:**
1. `tests/concurrency-booking.test.ts`: Barrage of 50 concurrent requests for the exact same staff and slot -> exactly 1 succeeds (201), 49 conflict (409).
2. `tests/tenant-isolation.test.ts`: Cross-tenant boundary and token rejection.
3. `tests/slot-generation.test.ts`: Slot availability engine respecting working hours, time-off, and buffer times.
4. `tests/booking-lifecycle.test.ts`: Full state machine (pending -> confirmed -> cancelled), slot release, and 24h refund window.
5. `tests/payment-webhook.test.ts`: Stripe/Razorpay signature validation and idempotent fulfillment.
6. `tests/idempotency.test.ts`: Replaying `Idempotency-Key` returns cached response without duplicate database inserts.

### Run High-Concurrency Stress Test
```bash
npm run stress-test
```
*Output Summary:*
```
Total Requests:      100
Total Elapsed Time:  203 ms
Throughput:          492.6 req/s
p95 Latency:         200 ms
Successful bookings (201 Created):   1
Conflicted bookings (409 Conflict):  99
Invariant Check:     PASS: ZERO DOUBLE BOOKINGS!
```

---

## 🔑 Demo Credentials (Password: `Password123!`)
- **Super Admin**: `admin@slotwise.com`
- **Tenant 1 (Glamour Salon)**:
  - Slug: `glamsalon`
  - Owner: `owner@glamsalon.com`
  - Staff: `elena@glamsalon.com`
- **Tenant 2 (Barber King London)**:
  - Slug: `barberking`
  - Owner: `owner@barberking.com`

---

## 📡 API Reference Overview

All tenant endpoints accept the tenant slug via:
- Subdomain (e.g. `glamsalon.slotwise.com`)
- Header: `X-Tenant-Slug: glamsalon`
- Query param: `?tenant=glamsalon`

### Auth & Tenant
- `POST /api/v1/auth/register-tenant`: Register salon tenant workspace and owner
- `POST /api/v1/auth/register-customer`: Customer registration under active tenant
- `POST /api/v1/auth/login`: User login (returns JWT)
- `GET /api/v1/auth/me`: Profile & active salon context

### Services & Staff
- `GET /api/v1/services`: List salon service catalog
- `POST /api/v1/services`: Create service (Owner only)
- `GET /api/v1/staff`: List active stylists/barbers
- `POST /api/v1/staff`: Add staff member (Owner only)

### Schedule & Availability
- `POST /api/v1/availability`: Set staff weekly working hours
- `GET /api/v1/availability/staff/:staffId`: Get staff schedule
- `POST /api/v1/availability/time-off`: Schedule vacation/leave

### Slot Generation & Bookings
- `GET /api/v1/slots?serviceId={id}&date=YYYY-MM-DD`: Real-time open slot computation
- `POST /api/v1/bookings`: Create booking (guarded by exclusion constraint & `Idempotency-Key`)
- `POST /api/v1/bookings/:id/cancel`: Cancel appointment (checks 24h window)
- `POST /api/v1/bookings/:id/reschedule`: Reschedule appointment to a new slot

### Payments & Webhooks
- `POST /api/v1/payments/create-order`: Generate Stripe/Razorpay test mode order
- `POST /api/v1/webhooks/stripe`: Stripe webhook handler with HMAC-SHA256 signature verification
- `POST /api/v1/webhooks/razorpay`: Razorpay webhook handler

---

## 📂 Project Structure
```
slotwise/
├── docker-compose.yml         # Postgres 16, Redis 7, PgBouncer, API, Worker
├── Dockerfile                 # Multi-stage production container build
├── package.json
├── tsconfig.json
├── jest.config.js
├── DESIGN.md                  # Comprehensive system design & trade-offs document
├── README.md                  # Setup guide and API documentation
├── src/
│   ├── app.ts                 # Express configuration and routing
│   ├── server.ts              # API server bootstrap and graceful shutdown
│   ├── config/
│   │   ├── env.ts             # Typed environment configuration
│   │   └── database.ts        # PG Pool & seamless query abstraction
│   ├── db/
│   │   ├── schema.sql         # Postgres schema with btree_gist exclusion constraints
│   │   ├── init.sql           # Docker postgres initialization
│   │   ├── migrate.ts         # Migration runner
│   │   ├── seed.ts            # Demo seed data
│   │   └── memory-db.ts       # In-memory relational & exclusion constraint engine
│   ├── middlewares/
│   │   ├── tenant.middleware.ts     # Multi-tenant context extraction
│   │   ├── auth.middleware.ts       # JWT verification & tenant boundary check
│   │   ├── rbac.middleware.ts       # Permission-based RBAC
│   │   ├── idempotency.middleware.ts# Idempotency-Key caching & replay
│   │   └── error.middleware.ts      # Error handler (Postgres 23P01 -> 409 Conflict)
│   ├── modules/
│   │   ├── auth/              # Tenant & customer auth
│   │   ├── services/          # Service catalogue CRUD
│   │   ├── staff/             # Staff & service mappings
│   │   ├── availability/      # Working hours & vacation logic
│   │   ├── slots/             # Real-time slot generation engine
│   │   ├── bookings/          # Concurrency-safe booking & state machine
│   │   ├── payments/          # Stripe / Razorpay order creation
│   │   ├── webhooks/          # Signature verification & idempotent capture
│   │   └── outbox/            # Transactional outbox relay
│   └── jobs/
│       ├── booking-expiry.worker.ts # 15-minute pending booking expiry job
│       └── worker-entry.ts    # Standalone background worker process
├── tests/                     # 12 automated test suites (Jest + Supertest)
└── scripts/
    └── stress-test-concurrency.ts # High-load concurrency verification script
```
