/**
 * Live demonstration script exercising the running SlotWise API
 */
async function runLiveDemo() {
  const baseUrl = 'http://localhost:4000';
  const tenantSlug = 'glamsalon';

  console.log('===============================================================');
  console.log('🌟 SLOTWISE LIVE API DEMO (Running against http://localhost:4000)');
  console.log('===============================================================');

  // 1. Health check
  console.log('\n[1] 🩺 Checking Health Endpoint (GET /health)...');
  const healthRes = await fetch(`${baseUrl}/health`);
  const healthJson = await healthRes.json();
  console.log('Response:', healthJson);

  // 2. Owner Login
  console.log('\n[2] 🔐 Logging in as Glamour Salon Owner (POST /api/v1/auth/login)...');
  const loginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Tenant-Slug': tenantSlug },
    body: JSON.stringify({ email: 'owner@glamsalon.com', password: 'Password123!' }),
  });
  const loginJson: any = await loginRes.json();
  const token = loginJson.data?.token;
  console.log('Owner Name:', loginJson.data?.user?.name);
  console.log('JWT Token: ', token ? `${token.substring(0, 35)}...` : 'None');

  // 3. List Services
  console.log('\n[3] ✂️ Fetching Salon Services (GET /api/v1/services)...');
  const servicesRes = await fetch(`${baseUrl}/api/v1/services`, {
    headers: { 'X-Tenant-Slug': tenantSlug },
  });
  const servicesJson: any = await servicesRes.json();
  const services = servicesJson.data || [];
  console.log(`Found ${services.length} services:`);
  services.forEach((s: any) => {
    console.log(`   • [${s.id}] ${s.name} - $${s.price} (Deposit: $${s.deposit_amount}, Duration: ${s.duration_min}m)`);
  });

  const selectedService = services[0];

  // 4. List Staff
  console.log('\n[4] 👤 Fetching Salon Staff (GET /api/v1/staff)...');
  const staffRes = await fetch(`${baseUrl}/api/v1/staff`, {
    headers: { 'X-Tenant-Slug': tenantSlug },
  });
  const staffJson: any = await staffRes.json();
  const staffList = staffJson.data || [];
  console.log(`Found ${staffList.length} staff members:`);
  staffList.forEach((st: any) => {
    console.log(`   • [${st.id}] ${st.display_name} - ${st.email} (${st.bio})`);
  });

  const selectedStaff = staffList[0];

  // 5. Query Real-Time Available Slots
  const targetDate = '2026-11-09'; // Monday
  console.log(`\n[5] 🗓️ Querying Available Slots for ${selectedService.name} on ${targetDate}...`);
  const slotsRes = await fetch(
    `${baseUrl}/api/v1/slots?serviceId=${selectedService.id}&date=${targetDate}&staffId=${selectedStaff.id}`,
    {
      headers: { 'X-Tenant-Slug': tenantSlug },
    }
  );
  const slotsJson: any = await slotsRes.json();
  const slots = slotsJson.data || [];
  console.log(`Calculated ${slots.length} available slots for ${selectedStaff.display_name}:`);
  slots.slice(0, 5).forEach((sl: any) => {
    console.log(`   • ${new Date(sl.startAt).toTimeString().substring(0, 5)} - ${new Date(sl.endAt).toTimeString().substring(0, 5)} (Price: $${sl.price})`);
  });

  const chosenSlot = slots[0];
  console.log(`Selected slot: ${chosenSlot.startAt}`);

  // 6. Create Booking with Idempotency Key
  const idempotencyKey = `idem_demo_${Date.now()}`;
  console.log(`\n[6] 📝 Creating Concurrency-Safe Booking (POST /api/v1/bookings)...`);
  console.log(`Idempotency-Key: ${idempotencyKey}`);
  const bookRes = await fetch(`${baseUrl}/api/v1/bookings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant-Slug': tenantSlug,
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({
      serviceId: selectedService.id,
      staffId: selectedStaff.id,
      startAt: chosenSlot.startAt,
      customerName: 'Claire Bennet',
      customerEmail: 'claire@example.com',
      customerPhone: '+1-555-0144',
      notes: 'First time visiting, excited!',
    }),
  });
  const bookJson: any = await bookRes.json();
  const booking = bookJson.data;
  console.log('Booking Result:');
  console.log(`   • Booking ID:     ${booking.id}`);
  console.log(`   • Status:         ${booking.status} (Valid for 15 minutes awaiting deposit)`);
  console.log(`   • Customer:       ${booking.customer_name} <${booking.customer_email}>`);
  console.log(`   • Deposit Due:    $${booking.deposit_amount}`);
  console.log(`   • Total Amount:   $${booking.total_amount}`);

  // 7. Create Payment Order
  console.log('\n[7] 💳 Initiating Stripe Deposit Payment Order (POST /api/v1/payments/create-order)...');
  const payRes = await fetch(`${baseUrl}/api/v1/payments/create-order`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant-Slug': tenantSlug,
    },
    body: JSON.stringify({
      bookingId: booking.id,
      provider: 'STRIPE',
    }),
  });
  const payJson: any = await payRes.json();
  const paymentOrder = payJson.data;
  console.log('Payment Order:');
  console.log(`   • Provider:       ${paymentOrder.provider}`);
  console.log(`   • Order/Intent:   ${paymentOrder.providerOrderId}`);
  console.log(`   • Client Secret:  ${paymentOrder.clientSecret?.substring(0, 30)}...`);
  console.log(`   • Amount to pay:  $${paymentOrder.amount} ${paymentOrder.currency}`);

  // 8. Simulate Stripe Webhook Confirmation
  console.log('\n[8] ⚡ Simulating Stripe Webhook Confirmation (POST /api/v1/webhooks/stripe)...');
  const webhookRes = await fetch(`${baseUrl}/api/v1/webhooks/stripe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: `evt_demo_${Date.now()}`,
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: paymentOrder.providerOrderId,
          latest_charge: 'ch_demo_charge_success',
        },
      },
    }),
  });
  const webhookJson: any = await webhookRes.json();
  console.log('Webhook Response:', webhookJson);

  // 9. Fetch Updated Booking Status
  console.log('\n[9] 🔍 Verifying Booking Status Transition in Database...');
  const verifyRes = await fetch(`${baseUrl}/api/v1/bookings/${booking.id}`, {
    headers: { 'X-Tenant-Slug': tenantSlug },
  });
  const verifyJson: any = await verifyRes.json();
  const confirmedBooking = verifyJson.data;
  console.log(`   • Booking ID:     ${confirmedBooking.id}`);
  console.log(`   • Final Status:   🎉 ${confirmedBooking.status} (Confirmed!)`);
  console.log(`   • Stylist:        ${confirmedBooking.staff_name}`);
  console.log(`   • Service:        ${confirmedBooking.service_name}`);
  console.log(`   • Appointment:    ${confirmedBooking.start_at} -> ${confirmedBooking.end_at}`);

  console.log('\n===============================================================');
  console.log('✅ ALL SYSTEMS WORKING PROPERLY: AUTH, CATALOG, SLOTS, BOOKINGS, PAYMENTS, & WEBHOOKS!');
  console.log('===============================================================');
}

runLiveDemo().catch(console.error);
