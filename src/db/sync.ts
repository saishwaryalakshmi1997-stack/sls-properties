import {
  getDatabase,
  onDatabaseChange,
  onPropertyDeleted,
  onTenantDeleted,
  onPaymentDeleted,
  onTransactionDeleted,
  onPaymentReset,
  onFlatVacated,
  formatFlatNumber,
  getFlatNumberVariants,
} from './database';
import { supabase } from '../lib/supabase';

let isSyncing = false;

// In-memory sets to prevent resurrecting recently deleted records when pulling from cloud
const deletedTenantIds = new Set<number>();
const deletedPaymentIds = new Set<number>();
const deletedTransactionIds = new Set<number>();
const resetPaymentKeys = new Set<string>();
const recentlyVacatedFlats = new Set<string>();

// ---------------- EXPLICIT SCHEMA MAPPERS (FOR SUPABASE) ---------------- //

function mapPropertyForCloud(p: any) {
  return {
    id: p.id,
    building_name: p.building_name || '',
    building_address: p.building_address || '',
    location: p.location || '',
    units: Number(p.units) || 1,
    landlord_name: p.landlord_name || '',
    notes: p.notes || '',
    created_at: p.created_at || new Date().toISOString(),
    updated_at: p.updated_at || new Date().toISOString(),
  };
}

function mapTenantForCloud(t: any) {
  return {
    id: t.id,
    property_id: t.property_id,
    flat_number: t.flat_number || '',
    name: t.name || '',
    phone_number: t.phone_number || '',
    occupation: t.occupation || '',
    rent_amount: Number(t.rent_amount) || 0,
    due_day: Number(t.due_day) || 1,
    rent_start_date: t.rent_start_date || '',
    rent_cycle: t.rent_cycle || 'first_of_month',
    maintenance_enabled: Number(t.maintenance_enabled) || 0,
    maintenance_amount: Number(t.maintenance_amount) || 0,
    security_deposit_enabled: Number(t.security_deposit_enabled) || 0,
    security_deposit_amount: Number(t.security_deposit_amount) || 0,
    security_deposit_date: t.security_deposit_date || '',
    water_billing_type: t.water_billing_type || 'per_unit',
    water_per_unit_charge: Number(t.water_per_unit_charge) || 0,
    water_current_reading: Number(t.water_current_reading) || 0,
    water_reading_date: t.water_reading_date || '',
    water_fixed_amount: Number(t.water_fixed_amount) || 0,
    electricity_billing_type: t.electricity_billing_type || 'per_unit',
    electricity_per_unit_charge: Number(t.electricity_per_unit_charge) || 10,
    electricity_current_reading: Number(t.electricity_current_reading) || 0,
    electricity_reading_date: t.electricity_reading_date || '',
    electricity_fixed_amount: Number(t.electricity_fixed_amount) || 0,
    eb_number: t.eb_number || '',
    aadhar_id: t.aadhar_id || '',
    is_id_verified: Number(t.is_id_verified) || 0,
    id_photo_uri: t.id_photo_uri || '',
    is_occupied: Number(t.is_occupied) || 1,
    created_at: t.created_at || new Date().toISOString(),
    updated_at: t.updated_at || new Date().toISOString(),
  };
}

function mapPaymentForCloud(py: any) {
  return {
    id: py.id,
    property_id: py.property_id,
    flat_number: py.flat_number || '',
    tenant_id: py.tenant_id || 0,
    month_year: py.month_year || '',
    amount: Number(py.amount) || 0,
    total_amount: Number(py.total_amount) || 0,
    paid_amount: Number(py.paid_amount) || 0,
    date_paid: py.date_paid || '',
    due_date: py.due_date || '',
    notes: py.notes || '',
    status: py.status || 'Paid',
    created_at: py.created_at || new Date().toISOString(),
    updated_at: py.updated_at || new Date().toISOString(),
  };
}

function mapTransactionForCloud(tx: any) {
  return {
    id: tx.id,
    payment_id: tx.payment_id || 0,
    property_id: tx.property_id,
    flat_number: tx.flat_number || '',
    month_year: tx.month_year || '',
    amount: Number(tx.amount) || 0,
    date_paid: tx.date_paid || '',
    notes: tx.notes || '',
    created_at: tx.created_at || new Date().toISOString(),
  };
}

function mapFlatEbForCloud(eb: any) {
  return {
    property_id: eb.property_id,
    flat_number: eb.flat_number,
    eb_number: eb.eb_number || '',
    updated_at: eb.updated_at || new Date().toISOString(),
  };
}

// ---------------- TWO-WAY SYNC FUNCTIONS ---------------- //

/**
 * 1. PUSH local SQLite data to Supabase (in strict relational order)
 */
export async function pushLocalToCloud(): Promise<void> {
  try {
    const db = await getDatabase();

    // 1. Properties (MUST be first so foreign keys exist)
    const localProps = await db.getAllAsync<any>('SELECT * FROM properties');
    if (localProps.length > 0) {
      const payload = localProps.map(mapPropertyForCloud);
      const { error } = await supabase.from('properties').upsert(payload, { onConflict: 'id' });
      if (error) {
        console.warn('[Sync Push] Properties push notice:', error.message);
        // If properties push fails, stop here to avoid cascading foreign-key violations
        return;
      }
    }

    // 2. Tenants (only for properties that exist)
    const localTenants = await db.getAllAsync<any>(
      'SELECT * FROM tenants WHERE property_id IN (SELECT id FROM properties)'
    );
    if (localTenants.length > 0) {
      const payload = localTenants.map(mapTenantForCloud);
      const { error } = await supabase.from('tenants').upsert(payload, { onConflict: 'id' });
      if (error) console.warn('[Sync Push] Tenants push notice:', error.message);
    }

    // 3. Payments (only for properties that exist)
    const localPayments = await db.getAllAsync<any>(
      'SELECT * FROM payments WHERE property_id IN (SELECT id FROM properties)'
    );
    if (localPayments.length > 0) {
      const payload = localPayments.map(mapPaymentForCloud);
      const { error } = await supabase.from('payments').upsert(payload, { onConflict: 'id' });
      if (error) console.warn('[Sync Push] Payments push notice:', error.message);
    }

    // 4. Payment Transactions (only for properties and payments that exist, excluding deleted ones)
    const localTx = await db.getAllAsync<any>(
      'SELECT * FROM payment_transactions WHERE property_id IN (SELECT id FROM properties) AND payment_id IN (SELECT id FROM payments)'
    );
    if (localTx.length > 0) {
      const payload = localTx
        .filter((tx) => !deletedTransactionIds.has(tx.id))
        .map(mapTransactionForCloud);
      if (payload.length > 0) {
        const { error } = await supabase.from('payment_transactions').upsert(payload, { onConflict: 'id' });
        if (error) console.warn('[Sync Push] Transactions push notice:', error.message);
      }
    }

    // 5. Flat EB Numbers
    const localEb = await db.getAllAsync<any>(
      'SELECT * FROM flat_eb_numbers WHERE property_id IN (SELECT id FROM properties)'
    );
    if (localEb.length > 0) {
      const payload = localEb.map(mapFlatEbForCloud);
      const { error } = await supabase.from('flat_eb_numbers').upsert(payload, { onConflict: 'property_id,flat_number' });
      if (error) console.warn('[Sync Push] Flat EB push notice:', error.message);
    }
  } catch (err: any) {
    console.warn('[Sync Push] Push to cloud notice:', err?.message || err);
  }
}

/**
 * 2. PULL cloud Supabase data into local SQLite
 */
export async function pullCloudToLocal(): Promise<void> {
  try {
    const db = await getDatabase();

    // 1. Fetch properties from cloud
    const { data: cloudProps, error: propErr } = await supabase
      .from('properties')
      .select('*');

    if (!propErr && cloudProps && cloudProps.length > 0) {
      for (const p of cloudProps) {
        const localProp = await db.getFirstAsync<any>(
          'SELECT updated_at FROM properties WHERE id = ?',
          [p.id]
        );
        if (localProp && localProp.updated_at) {
          const localTime = new Date(localProp.updated_at).getTime();
          const cloudTime = new Date(p.updated_at || 0).getTime();
          if (localTime > cloudTime) {
            continue;
          }
        }

        await db.runAsync(
          `INSERT INTO properties (id, building_name, building_address, location, units, landlord_name, notes, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             building_name = excluded.building_name,
             building_address = excluded.building_address,
             location = excluded.location,
             units = excluded.units,
             landlord_name = excluded.landlord_name,
             notes = excluded.notes,
             updated_at = excluded.updated_at`,
          [
            p.id,
            p.building_name || '',
            p.building_address || '',
            p.location || '',
            p.units || 1,
            p.landlord_name || '',
            p.notes || '',
            p.created_at || new Date().toISOString(),
            p.updated_at || new Date().toISOString(),
          ]
        );
      }
    }

    // 2. Fetch tenants from cloud
    const { data: cloudTenants, error: tenantErr } = await supabase
      .from('tenants')
      .select('*');

    if (!tenantErr && cloudTenants && cloudTenants.length > 0) {
      for (const t of cloudTenants) {
        const rawFlat = (t.flat_number || '').trim();
        const normFlat = formatFlatNumber(rawFlat);
        const flatKey = `${t.property_id}:${rawFlat.toLowerCase()}`;
        const normKey = `${t.property_id}:${normFlat.toLowerCase()}`;

        if (deletedTenantIds.has(t.id) || recentlyVacatedFlats.has(flatKey) || recentlyVacatedFlats.has(normKey)) {
          deleteTenantFromCloud(t.id);
          continue;
        }

        const localTenant = await db.getFirstAsync<any>(
          'SELECT updated_at FROM tenants WHERE id = ?',
          [t.id]
        );
        if (localTenant && localTenant.updated_at) {
          const localTime = new Date(localTenant.updated_at).getTime();
          const cloudTime = new Date(t.updated_at || 0).getTime();
          if (localTime > cloudTime) {
            continue;
          }
        }

        await db.runAsync(
          `INSERT INTO tenants (
             id, property_id, flat_number, name, phone_number, occupation, rent_amount,
             due_day, rent_start_date, rent_cycle, maintenance_enabled, maintenance_amount,
             security_deposit_enabled, security_deposit_amount, security_deposit_date,
             water_billing_type, water_per_unit_charge, water_current_reading, water_reading_date, water_fixed_amount,
             electricity_billing_type, electricity_per_unit_charge, electricity_current_reading, electricity_reading_date, electricity_fixed_amount,
             eb_number, aadhar_id, is_id_verified, id_photo_uri, is_occupied, created_at, updated_at
           ) VALUES (
             ?, ?, ?, ?, ?, ?, ?,
             ?, ?, ?, ?, ?,
             ?, ?, ?,
             ?, ?, ?, ?, ?,
             ?, ?, ?, ?, ?,
             ?, ?, ?, ?, ?, ?, ?
           )
           ON CONFLICT(id) DO UPDATE SET
             property_id = excluded.property_id,
             flat_number = excluded.flat_number,
             name = excluded.name,
             phone_number = excluded.phone_number,
             occupation = excluded.occupation,
             rent_amount = excluded.rent_amount,
             due_day = excluded.due_day,
             rent_start_date = excluded.rent_start_date,
             rent_cycle = excluded.rent_cycle,
             maintenance_enabled = excluded.maintenance_enabled,
             maintenance_amount = excluded.maintenance_amount,
             security_deposit_enabled = excluded.security_deposit_enabled,
             security_deposit_amount = excluded.security_deposit_amount,
             security_deposit_date = excluded.security_deposit_date,
             water_billing_type = excluded.water_billing_type,
             water_per_unit_charge = excluded.water_per_unit_charge,
             water_current_reading = excluded.water_current_reading,
             water_reading_date = excluded.water_reading_date,
             water_fixed_amount = excluded.water_fixed_amount,
             electricity_billing_type = excluded.electricity_billing_type,
             electricity_per_unit_charge = excluded.electricity_per_unit_charge,
             electricity_current_reading = excluded.electricity_current_reading,
             electricity_reading_date = excluded.electricity_reading_date,
             electricity_fixed_amount = excluded.electricity_fixed_amount,
             eb_number = excluded.eb_number,
             aadhar_id = excluded.aadhar_id,
             is_id_verified = excluded.is_id_verified,
             id_photo_uri = excluded.id_photo_uri,
             is_occupied = excluded.is_occupied,
             updated_at = excluded.updated_at`,
          [
            t.id,
            t.property_id,
            t.flat_number,
            t.name,
            t.phone_number || '',
            t.occupation || '',
            t.rent_amount || 0,
            t.due_day || 1,
            t.rent_start_date || '',
            t.rent_cycle || 'first_of_month',
            t.maintenance_enabled || 0,
            t.maintenance_amount || 0,
            t.security_deposit_enabled || 0,
            t.security_deposit_amount || 0,
            t.security_deposit_date || '',
            t.water_billing_type || 'per_unit',
            t.water_per_unit_charge || 0,
            t.water_current_reading || 0,
            t.water_reading_date || '',
            t.water_fixed_amount || 0,
            t.electricity_billing_type || 'per_unit',
            t.electricity_per_unit_charge || 10,
            t.electricity_current_reading || 0,
            t.electricity_reading_date || '',
            t.electricity_fixed_amount || 0,
            t.eb_number || '',
            t.aadhar_id || '',
            t.is_id_verified || 0,
            t.id_photo_uri || '',
            t.is_occupied || 1,
            t.created_at || new Date().toISOString(),
            t.updated_at || new Date().toISOString(),
          ]
        );
      }
    }

    // 3. Fetch payments from cloud
    const { data: cloudPayments, error: payErr } = await supabase
      .from('payments')
      .select('*');

    if (!payErr && cloudPayments && cloudPayments.length > 0) {
      for (const py of cloudPayments) {
        const rawFlat = (py.flat_number || '').trim();
        const normFlat = formatFlatNumber(rawFlat);
        const flatKey = `${py.property_id}:${rawFlat.toLowerCase()}`;
        const normKey = `${py.property_id}:${normFlat.toLowerCase()}`;

        if (deletedPaymentIds.has(py.id) || recentlyVacatedFlats.has(flatKey) || recentlyVacatedFlats.has(normKey)) {
          deletePaymentFromCloud(py.id);
          continue;
        }

        const cleanM = (py.month_year || '').trim().toLowerCase();
        const pyVariants = getFlatNumberVariants(rawFlat);
        const isResetPay = pyVariants.some((v) =>
          resetPaymentKeys.has(`${py.property_id}:${v.toLowerCase()}:${cleanM}`) ||
          resetPaymentKeys.has(`${py.property_id}:${v.toLowerCase()}:${(py.month_year || '').trim()}`)
        );

        if (isResetPay) {
          // If payment was reset to Pending locally, ensure Supabase reflects it and DO NOT overwrite local
          if (py.status === 'Paid' || (py.paid_amount || 0) > 0) {
            resetPaymentInCloud(py.id);
          }
          continue;
        }

        // Check if payment already exists for this property, flat, and month to prevent duplicates
        const placeholders = pyVariants.map(() => '?').join(', ');
        const existingMatch = await db.getFirstAsync<any>(
          `SELECT id, updated_at, status, paid_amount FROM payments 
           WHERE property_id = ? AND flat_number IN (${placeholders}) 
           AND (month_year = ? OR LOWER(TRIM(month_year)) = LOWER(TRIM(?)))`,
          [py.property_id, ...pyVariants, py.month_year, py.month_year]
        );

        if (existingMatch) {
          const localTime = existingMatch.updated_at ? new Date(existingMatch.updated_at).getTime() : 0;
          const cloudTime = py.updated_at ? new Date(py.updated_at).getTime() : 0;
          if (localTime >= cloudTime) {
            continue;
          }
          // If local record was reset to Pending with paid_amount 0, NEVER overwrite with cloud Paid!
          if (existingMatch.status === 'Pending' && (existingMatch.paid_amount || 0) === 0 && (py.status === 'Paid' || (py.paid_amount || 0) > 0)) {
            continue;
          }
          await db.runAsync(
            `UPDATE payments 
             SET amount = ?, total_amount = ?, paid_amount = ?, date_paid = ?, due_date = ?, notes = ?, status = ?, updated_at = ?
             WHERE id = ?`,
            [
              py.amount || 0,
              py.total_amount || 0,
              py.paid_amount || 0,
              py.date_paid || '',
              py.due_date || '',
              py.notes || '',
              py.status || 'Paid',
              py.updated_at || new Date().toISOString(),
              existingMatch.id,
            ]
          );
        } else {
          if (isResetPay) {
            continue;
          }
          await db.runAsync(
            `INSERT INTO payments (id, property_id, flat_number, tenant_id, month_year, amount, total_amount, paid_amount, date_paid, due_date, notes, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               property_id = excluded.property_id,
               flat_number = excluded.flat_number,
               tenant_id = excluded.tenant_id,
               month_year = excluded.month_year,
               amount = excluded.amount,
               total_amount = excluded.total_amount,
               paid_amount = excluded.paid_amount,
               date_paid = excluded.date_paid,
               due_date = excluded.due_date,
               notes = excluded.notes,
               status = excluded.status,
               updated_at = excluded.updated_at`,
            [
              py.id,
              py.property_id,
              normFlat,
              py.tenant_id || 0,
              py.month_year,
              py.amount || 0,
              py.total_amount || 0,
              py.paid_amount || 0,
              py.date_paid || '',
              py.due_date || '',
              py.notes || '',
              py.status || 'Paid',
              py.created_at || new Date().toISOString(),
              py.updated_at || new Date().toISOString(),
            ]
          );
        }
      }
    }

    // 4. Fetch payment transactions from cloud
    const { data: cloudTx, error: txErr } = await supabase
      .from('payment_transactions')
      .select('*');

    if (!txErr && cloudTx && cloudTx.length > 0) {
      for (const tx of cloudTx) {
        const rawFlat = (tx.flat_number || '').trim();
        const normFlat = formatFlatNumber(rawFlat);
        const flatKey = `${tx.property_id}:${rawFlat.toLowerCase()}`;
        const normKey = `${tx.property_id}:${normFlat.toLowerCase()}`;

        if (recentlyVacatedFlats.has(flatKey) || recentlyVacatedFlats.has(normKey)) {
          deleteTransactionFromCloud(tx.id);
          continue;
        }

        const cleanM = (tx.month_year || '').trim().toLowerCase();
        const txVariants = getFlatNumberVariants(rawFlat);
        const isResetTx = txVariants.some((v) =>
          resetPaymentKeys.has(`${tx.property_id}:${v.toLowerCase()}:${cleanM}`) ||
          resetPaymentKeys.has(`${tx.property_id}:${v.toLowerCase()}:${(tx.month_year || '').trim()}`)
        );

        if (deletedTransactionIds.has(tx.id) || isResetTx) {
          deleteTransactionFromCloud(tx.id);
          continue;
        }

        await db.runAsync(
          `INSERT INTO payment_transactions (id, payment_id, property_id, flat_number, month_year, amount, date_paid, notes, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             amount = excluded.amount,
             date_paid = excluded.date_paid,
             notes = excluded.notes`,
          [
            tx.id,
            tx.payment_id || 0,
            tx.property_id,
            normFlat,
            tx.month_year,
            tx.amount || 0,
            tx.date_paid || '',
            tx.notes || '',
            tx.created_at || new Date().toISOString(),
          ]
        );
      }
    }

    // 5. Fetch flat EB numbers from cloud
    const { data: cloudEb, error: ebErr } = await supabase
      .from('flat_eb_numbers')
      .select('*');

    if (!ebErr && cloudEb && cloudEb.length > 0) {
      for (const eb of cloudEb) {
        const localEb = await db.getFirstAsync<any>(
          'SELECT updated_at FROM flat_eb_numbers WHERE property_id = ? AND flat_number = ?',
          [eb.property_id, eb.flat_number]
        );
        if (localEb && localEb.updated_at) {
          const localTime = new Date(localEb.updated_at).getTime();
          const cloudTime = new Date(eb.updated_at || 0).getTime();
          if (localTime > cloudTime) {
            continue;
          }
        }

        await db.runAsync(
          `INSERT INTO flat_eb_numbers (property_id, flat_number, eb_number, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(property_id, flat_number) DO UPDATE SET
             eb_number = excluded.eb_number,
             updated_at = excluded.updated_at`,
          [
            eb.property_id,
            eb.flat_number,
            eb.eb_number || '',
            eb.updated_at || new Date().toISOString(),
          ]
        );
      }
    }
  } catch (err: any) {
    console.warn('[Sync Pull] Pull from cloud notice:', err?.message || err);
  }
}

/**
 * Main 2-way sync: Pushes local changes FIRST, then pulls cloud updates.
 * Guaranteed never to throw errors or freeze the UI if offline.
 */
export async function syncAll(): Promise<void> {
  if (isSyncing) return;
  isSyncing = true;
  try {
    // 1. PUSH local additions/edits to cloud FIRST so local changes are safely recorded remotely
    await pushLocalToCloud();
    // 2. PULL updates from cloud (Phone 2 gets Phone 1's changes) with timestamp protection
    await pullCloudToLocal();
  } catch (err: any) {
    console.warn('[Cloud Sync] Background sync notice:', err?.message || err);
  } finally {
    isSyncing = false;
  }
}

// Background fire-and-forget sync helper
export function triggerBackgroundSync(): void {
  syncAll().catch((err) => {
    console.warn('[Cloud Sync] Auto-trigger notice:', err);
  });
}

// Delete helpers for immediate remote cleanup
export function deletePropertyFromCloud(id: number): void {
  supabase
    .from('properties')
    .delete()
    .eq('id', id)
    .then(({ error }) => {
      if (error) console.warn('[Sync] deleteProperty notice:', error.message);
    }, () => {});
}

export function deleteTenantFromCloud(id: number): void {
  deletedTenantIds.add(id);
  supabase
    .from('tenants')
    .delete()
    .eq('id', id)
    .then(({ error }) => {
      if (error) console.warn('[Sync] deleteTenant notice:', error.message);
    }, () => {});
}

export function deletePaymentFromCloud(id: number): void {
  deletedPaymentIds.add(id);
  supabase
    .from('payments')
    .delete()
    .eq('id', id)
    .then(({ error }) => {
      if (error) console.warn('[Sync] deletePayment notice:', error.message);
    }, () => {});
}

export function deleteTransactionFromCloud(id: number): void {
  deletedTransactionIds.add(id);
  supabase
    .from('payment_transactions')
    .delete()
    .eq('id', id)
    .then(({ error }) => {
      if (error) console.warn('[Sync] deleteTransaction notice:', error.message);
    }, () => {});
}

export function resetPaymentInCloud(id: number): void {
  supabase
    .from('payments')
    .update({
      paid_amount: 0,
      status: 'Pending',
      date_paid: '',
      notes: '',
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .then(
      ({ error }) => {
        if (error) console.warn('[Sync] resetPayment notice:', error.message);
      },
      () => {}
    );
}

// ---------------- WIRE DATABASE OBSERVER LISTENERS ---------------- //
// This allows sync.ts to observe database changes without database.ts needing to import sync.ts!
// Eliminates the Require Cycle completely.
onDatabaseChange(() => {
  triggerBackgroundSync();
});

onPropertyDeleted((id) => {
  deletePropertyFromCloud(id);
});

onTenantDeleted((id) => {
  deleteTenantFromCloud(id);
});

onPaymentDeleted((id) => {
  deletePaymentFromCloud(id);
});

onTransactionDeleted((txId) => {
  deleteTransactionFromCloud(txId);
});

onPaymentReset(async (propertyId, flatNumber, normFlat, monthYear, txIds, paymentIds, flatVariants) => {
  const cleanM = monthYear.trim().toLowerCase();
  const variants = flatVariants && flatVariants.length > 0 ? flatVariants : getFlatNumberVariants(flatNumber);

  for (const v of variants) {
    resetPaymentKeys.add(`${propertyId}:${v.trim().toLowerCase()}:${cleanM}`);
    resetPaymentKeys.add(`${propertyId}:${v.trim().toLowerCase()}:${monthYear.trim()}`);
  }

  txIds.forEach((id) => deletedTransactionIds.add(id));

  try {
    if (txIds.length > 0) {
      await supabase.from('payment_transactions').delete().in('id', txIds);
    }
    if (paymentIds.length > 0) {
      await supabase.from('payment_transactions').delete().in('payment_id', paymentIds);
    }
    await supabase
      .from('payment_transactions')
      .delete()
      .eq('property_id', propertyId)
      .ilike('month_year', monthYear.trim())
      .in('flat_number', variants);

    // Update Supabase payment to Pending with 0 paid
    await supabase
      .from('payments')
      .update({
        paid_amount: 0,
        status: 'Pending',
        date_paid: '',
        notes: '',
        updated_at: new Date().toISOString(),
      })
      .eq('property_id', propertyId)
      .ilike('month_year', monthYear.trim())
      .in('flat_number', variants);

    if (paymentIds.length > 0) {
      await supabase
        .from('payments')
        .update({
          paid_amount: 0,
          status: 'Pending',
          date_paid: '',
          notes: '',
          updated_at: new Date().toISOString(),
        })
        .in('id', paymentIds);
    }
  } catch (err) {
    console.warn('[Sync] Cloud deletion on payment reset notice:', err);
  }
});

onFlatVacated(async (propertyId, flatNumber, normFlat) => {
  const key1 = `${propertyId}:${flatNumber.toLowerCase()}`;
  const key2 = `${propertyId}:${normFlat.toLowerCase()}`;
  recentlyVacatedFlats.add(key1);
  recentlyVacatedFlats.add(key2);

  try {
    await supabase.from('payment_transactions').delete().eq('property_id', propertyId).in('flat_number', [flatNumber, normFlat]);
    await supabase.from('payments').delete().eq('property_id', propertyId).in('flat_number', [flatNumber, normFlat]);
    await supabase.from('tenants').delete().eq('property_id', propertyId).in('flat_number', [flatNumber, normFlat]);
  } catch (err) {
    console.warn('[Sync] Cloud deletion on flat vacate notice:', err);
  }
});
