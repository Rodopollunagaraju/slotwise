import bcrypt from 'bcryptjs';
import { db } from '../config/database';
import { runMigrations } from './migrate';

export async function seedDatabase() {
  console.log('[Seed] Seeding demo tenants and accounts...');

  await runMigrations();

  const passwordHash = await bcrypt.hash('Password123!', 10);

  // 1. Super Admin
  await db.query(
    `INSERT INTO users (tenant_id, role, email, password_hash, name, phone)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [null, 'SUPER_ADMIN', 'admin@slotwise.com', passwordHash, 'SlotWise Super Admin', '+1-800-555-0100']
  );

  // 2. Tenant 1: Glamour Salon
  const t1Res = await db.query(
    `INSERT INTO tenants (slug, name, email, phone, currency, cancellation_window_hours)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    ['glamsalon', 'Glamour Salon & Spa', 'contact@glamsalon.com', '+1-555-0199', 'USD', 24]
  );
  const tenant1Id = t1Res.rows[0].id;

  // Glamour Owner
  await db.query(
    `INSERT INTO users (tenant_id, role, email, password_hash, name, phone)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [tenant1Id, 'OWNER', 'owner@glamsalon.com', passwordHash, 'Sophie Glamour', '+1-555-0199']
  );

  // Glamour Services
  const s1 = await db.query(
    `INSERT INTO services (tenant_id, name, description, duration_min, price, deposit_amount, buffer_after_min)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [tenant1Id, 'Signature Haircut & Style', 'Full consultation, wash, precision cut, and blowout styling.', 45, 65.00, 20.00, 15]
  );
  const haircutService = s1.rows[0];

  const s2 = await db.query(
    `INSERT INTO services (tenant_id, name, description, duration_min, price, deposit_amount, buffer_after_min)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [tenant1Id, 'Balayage Color Treatment', 'Hand-painted sun-kissed hair highlights with toner and gloss.', 90, 160.00, 50.00, 15]
  );
  const balayageService = s2.rows[0];

  await db.query(
    `INSERT INTO services (tenant_id, name, description, duration_min, price, deposit_amount, buffer_after_min)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [tenant1Id, 'Deluxe Manicure', 'Nail shaping, cuticle care, hand scrub, and gel polish.', 30, 45.00, 15.00, 10]
  );

  // Glamour Staff 1: Elena Rostova
  const staff1UserRes = await db.query(
    `INSERT INTO users (tenant_id, role, email, password_hash, name, phone)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [tenant1Id, 'STAFF', 'elena@glamsalon.com', passwordHash, 'Elena Rostova', '+1-555-0101']
  );
  const staff1Res = await db.query(
    `INSERT INTO staff (tenant_id, user_id, display_name, bio)
     VALUES ($1, $2, $3, $4)`,
    [tenant1Id, staff1UserRes.rows[0].id, 'Elena Rostova', 'Senior Hair Stylist with 8+ years experience in European styling.']
  );
  const elenaId = staff1Res.rows[0].id;

  // Link Elena to haircut and balayage
  await db.query(
    `INSERT INTO staff_services (tenant_id, staff_id, service_id)
     VALUES ($1, $2, $3)`,
    [tenant1Id, elenaId, haircutService.id]
  );
  await db.query(
    `INSERT INTO staff_services (tenant_id, staff_id, service_id)
     VALUES ($1, $2, $3)`,
    [tenant1Id, elenaId, balayageService.id]
  );

  // Elena's Working Hours: Monday to Friday 09:00 - 18:00
  for (let day = 1; day <= 5; day++) {
    await db.query(
      `INSERT INTO availability (tenant_id, staff_id, day_of_week, start_time, end_time)
       VALUES ($1, $2, $3, $4, $5)`,
      [tenant1Id, elenaId, day, '09:00', '18:00']
    );
  }

  // 3. Tenant 2: Barber King
  const t2Res = await db.query(
    `INSERT INTO tenants (slug, name, email, phone, currency, cancellation_window_hours)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    ['barberking', 'Barber King London', 'contact@barberking.com', '+44-20-7946-0991', 'GBP', 12]
  );
  const tenant2Id = t2Res.rows[0].id;

  // Barber King Owner
  await db.query(
    `INSERT INTO users (tenant_id, role, email, password_hash, name, phone)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [tenant2Id, 'OWNER', 'owner@barberking.com', passwordHash, 'Arthur King', '+44-20-7946-0991']
  );

  // Barber King Service
  await db.query(
    `INSERT INTO services (tenant_id, name, description, duration_min, price, deposit_amount, buffer_after_min)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [tenant2Id, 'Royal Beard Groom & Cut', 'Traditional hot towel shave and scissor cut.', 40, 45.00, 15.00, 10]
  );

  console.log('✅ [Seed] Database seeded successfully!');
  console.log('--- Demo Logins (Password: Password123!) ---');
  console.log('Super Admin: admin@slotwise.com');
  console.log('Tenant 1 (Glamour): owner@glamsalon.com (slug: glamsalon)');
  console.log('Tenant 1 Staff: elena@glamsalon.com');
  console.log('Tenant 2 (Barber King): owner@barberking.com (slug: barberking)');
}

if (require.main === module) {
  seedDatabase()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
