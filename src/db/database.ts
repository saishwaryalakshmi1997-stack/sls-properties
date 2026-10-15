import * as SQLite from 'expo-sqlite';

// ---------------- OBSERVER LISTENERS FOR DECOUPLED SYNC ---------------- //
// This allows sync.ts to observe database events without database.ts importing sync.ts.
// Eliminates the Metro Require Cycle.
type ChangeListener = () => void;
type IdListener = (id: number) => void;

const changeListeners: ChangeListener[] = [];
const propDeleteListeners: IdListener[] = [];
const tenantDeleteListeners: IdListener[] = [];
const payDeleteListeners: IdListener[] = [];

export function onDatabaseChange(fn: ChangeListener) {
  changeListeners.push(fn);
}

export function onPropertyDeleted(fn: IdListener) {
  propDeleteListeners.push(fn);
}

export function onTenantDeleted(fn: IdListener) {
  tenantDeleteListeners.push(fn);
}

export function onPaymentDeleted(fn: IdListener) {
  payDeleteListeners.push(fn);
}

function notifyChange() {
  changeListeners.forEach((fn) => {
    try {
      fn();
    } catch (err) {
      console.warn('[SQLite] Change listener error:', err);
    }
  });
}

function notifyPropertyDeleted(id: number) {
  propDeleteListeners.forEach((fn) => {
    try {
      fn(id);
    } catch (err) {
      console.warn('[SQLite] Property delete listener error:', err);
    }
  });
}

function notifyTenantDeleted(id: number) {
  tenantDeleteListeners.forEach((fn) => {
    try {
      fn(id);
    } catch (err) {
      console.warn('[SQLite] Tenant delete listener error:', err);
    }
  });
}

function notifyPaymentDeleted(id: number) {
  payDeleteListeners.forEach((fn) => {
    try {
      fn(id);
    } catch (err) {
      console.warn('[SQLite] Payment delete listener error:', err);
    }
  });
}

export interface TestLogRecord {
  id: number;
  message: string;
  created_at: string;
}

export interface DbTestResult {
  success: boolean;
  message: string;
  totalRecords: number;
  latestRecord?: TestLogRecord;
  error?: string;
}

export interface Property {
  id: number;
  building_name: string;
  building_address: string;
  location: string;
  units: number;
  landlord_name: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

export type PropertyInput = Omit<Property, 'id' | 'created_at' | 'updated_at'>;

export interface PropertyStats {
  totalProperties: number;
  totalUnits: number;
}

export interface Tenant {
  id: number;
  property_id: number;
  flat_number: string;
  name: string;
  phone_number: string;
  occupation: string;
  rent_amount: number;
  due_day: number;
  rent_start_date: string;
  rent_cycle?: string;
  maintenance_enabled?: number;
  maintenance_amount?: number;
  security_deposit_enabled?: number;
  security_deposit_amount?: number;
  security_deposit_date?: string;
  water_billing_type?: string;
  water_per_unit_charge?: number;
  water_current_reading?: number;
  water_reading_date?: string;
  water_fixed_amount?: number;
  electricity_billing_type?: string;
  electricity_per_unit_charge?: number;
  electricity_current_reading?: number;
  electricity_reading_date?: string;
  electricity_last_reading?: number;
  electricity_last_reading_date?: string;
  electricity_fixed_amount?: number;
  water_last_reading?: number;
  water_last_reading_date?: string;
  aadhar_id: string; // ID proof number (optional)
  is_id_verified: number; // 0 or 1
  id_photo_uri: string;
  eb_number?: string;
  is_occupied: number;
  created_at: string;
  updated_at: string;
}

export type TenantInput = Omit<Tenant, 'id' | 'created_at' | 'updated_at'>;

export interface FlatItem {
  flat_number: string;
  is_occupied: boolean;
  tenant?: Tenant;
  eb_number?: string;
}

/**
 * Normalizes flat numbers across the entire app so that duplicated prefixes like
 * "Flat - Flat 1", "Flat - 1", "Flats - 1", "flat-flat1" are cleaned up to "Flat 1".
 */
export function formatFlatNumber(flatNumber?: string | null): string {
  if (!flatNumber || !flatNumber.trim()) return '';
  const s = flatNumber.trim();
  
  const hasFlatPrefix = /^(flat|flats)/i.test(s);
  
  let stripped = s;
  while (/^(flat|flats)\s*[-:]?\s*/i.test(stripped) || /^[-:]+\s*/.test(stripped)) {
    stripped = stripped.replace(/^(flat|flats)\s*[-:]?\s*/i, '').replace(/^[-:]+\s*/, '').trim();
  }

  if (!stripped) {
    return 'Flat 1';
  }

  if (hasFlatPrefix || /^\d+[A-Za-z]?$/.test(stripped)) {
    return `Flat ${stripped}`;
  }

  return s;
}


export interface PaymentTransaction {
  id: number;
  payment_id: number;
  property_id: number;
  flat_number: string;
  month_year: string;
  amount: number;
  date_paid: string;
  notes: string;
  created_at: string;
}

export interface PaymentRecord {
  id: number;
  property_id: number;
  flat_number: string;
  tenant_id: number;
  month_year: string;
  amount: number;
  total_amount?: number;
  paid_amount?: number;
  date_paid: string;
  due_date: string;
  notes: string;
  status: 'Paid' | 'Pending' | 'Partial';
  transactions?: PaymentTransaction[];
  created_at: string;
  updated_at: string;
}

export type PaymentInput = Omit<PaymentRecord, 'id' | 'created_at' | 'updated_at'>;

let dbInstance: SQLite.SQLiteDatabase | null = null;
let initPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function ensureTables(db: SQLite.SQLiteDatabase): Promise<void> {
  // Create tables if they do not exist
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS test_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS properties (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      building_name TEXT NOT NULL DEFAULT '',
      building_address TEXT NOT NULL DEFAULT '',
      location TEXT DEFAULT '',
      units INTEGER NOT NULL DEFAULT 1,
      landlord_name TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS tenants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      property_id INTEGER NOT NULL,
      flat_number TEXT NOT NULL,
      name TEXT NOT NULL,
      phone_number TEXT NOT NULL DEFAULT '',
      occupation TEXT NOT NULL DEFAULT '',
      rent_amount REAL NOT NULL DEFAULT 0,
      due_day INTEGER NOT NULL DEFAULT 1,
      rent_start_date TEXT NOT NULL DEFAULT '',
      rent_cycle TEXT NOT NULL DEFAULT 'first_of_month',
      maintenance_enabled INTEGER NOT NULL DEFAULT 0,
      maintenance_amount REAL NOT NULL DEFAULT 0,
      security_deposit_enabled INTEGER NOT NULL DEFAULT 0,
      security_deposit_amount REAL NOT NULL DEFAULT 0,
      security_deposit_date TEXT NOT NULL DEFAULT '',
      water_billing_type TEXT NOT NULL DEFAULT 'per_unit',
      water_per_unit_charge REAL NOT NULL DEFAULT 0,
      water_current_reading REAL NOT NULL DEFAULT 0,
      water_reading_date TEXT NOT NULL DEFAULT '',
      water_fixed_amount REAL NOT NULL DEFAULT 0,
      electricity_billing_type TEXT NOT NULL DEFAULT 'per_unit',
      electricity_per_unit_charge REAL NOT NULL DEFAULT 10,
      electricity_current_reading REAL NOT NULL DEFAULT 0,
      electricity_reading_date TEXT NOT NULL DEFAULT '',
      electricity_fixed_amount REAL NOT NULL DEFAULT 0,
      eb_number TEXT NOT NULL DEFAULT '',
      aadhar_id TEXT NOT NULL DEFAULT '',
      is_id_verified INTEGER NOT NULL DEFAULT 0,
      id_photo_uri TEXT NOT NULL DEFAULT '',
      is_occupied INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      property_id INTEGER NOT NULL,
      flat_number TEXT NOT NULL,
      tenant_id INTEGER NOT NULL DEFAULT 0,
      month_year TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      total_amount REAL NOT NULL DEFAULT 0,
      paid_amount REAL NOT NULL DEFAULT 0,
      date_paid TEXT NOT NULL DEFAULT '',
      due_date TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Paid',
      created_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS payment_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payment_id INTEGER NOT NULL DEFAULT 0,
      property_id INTEGER NOT NULL,
      flat_number TEXT NOT NULL,
      month_year TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      date_paid TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS flat_eb_numbers (
      property_id INTEGER NOT NULL,
      flat_number TEXT NOT NULL,
      eb_number TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (property_id, flat_number)
    );
  `);

  // Migrate existing EB numbers from tenants to flat_eb_numbers if not already there
  try {
    await db.execAsync(`
      INSERT OR IGNORE INTO flat_eb_numbers (property_id, flat_number, eb_number, updated_at)
      SELECT property_id, flat_number, eb_number, updated_at
      FROM tenants
      WHERE eb_number != '' AND eb_number IS NOT NULL;
    `);
  } catch (seedErr) {
    console.warn('[SQLite] flat_eb_numbers seed warning:', seedErr);
  }

  // Safe non-destructive column migration for existing tables
  try {
    const tableInfo = await db.getAllAsync<{ name: string }>(
      `PRAGMA table_info(properties)`
    );
    const cols = tableInfo.map((c) => c.name);

    if (!cols.includes('building_name')) {
      await db.execAsync(`ALTER TABLE properties ADD COLUMN building_name TEXT DEFAULT '';`);
      if (cols.includes('name')) {
        await db.execAsync(`UPDATE properties SET building_name = name WHERE building_name = '' OR building_name IS NULL;`);
      }
    }
    if (!cols.includes('building_address')) {
      await db.execAsync(`ALTER TABLE properties ADD COLUMN building_address TEXT DEFAULT '';`);
      if (cols.includes('address')) {
        await db.execAsync(`UPDATE properties SET building_address = address WHERE building_address = '' OR building_address IS NULL;`);
      }
    }
    if (!cols.includes('location')) {
      await db.execAsync(`ALTER TABLE properties ADD COLUMN location TEXT DEFAULT '';`);
    }

    // Migrate tenants table columns
    const tenantTableInfo = await db.getAllAsync<{ name: string }>(
      `PRAGMA table_info(tenants)`
    );
    const tenantCols = tenantTableInfo.map((c) => c.name);

    if (!tenantCols.includes('rent_amount')) {
      await db.execAsync(`ALTER TABLE tenants ADD COLUMN rent_amount REAL DEFAULT 0;`);
    }
    if (!tenantCols.includes('due_day')) {
      await db.execAsync(`ALTER TABLE tenants ADD COLUMN due_day INTEGER DEFAULT 1;`);
    }
    if (!tenantCols.includes('rent_start_date')) {
      await db.execAsync(`ALTER TABLE tenants ADD COLUMN rent_start_date TEXT DEFAULT '';`);
    }
    if (!tenantCols.includes('is_id_verified')) {
      await db.execAsync(`ALTER TABLE tenants ADD COLUMN is_id_verified INTEGER DEFAULT 0;`);
    }
    if (!tenantCols.includes('id_photo_uri')) {
      await db.execAsync(`ALTER TABLE tenants ADD COLUMN id_photo_uri TEXT DEFAULT '';`);
    }

    // Extended tenant utility & billing columns
    const extendedTenantCols: { [key: string]: string } = {
      rent_cycle: "TEXT DEFAULT 'first_of_month'",
      maintenance_enabled: "INTEGER DEFAULT 0",
      maintenance_amount: "REAL DEFAULT 0",
      security_deposit_enabled: "INTEGER DEFAULT 0",
      security_deposit_amount: "REAL DEFAULT 0",
      security_deposit_date: "TEXT DEFAULT ''",
      water_billing_type: "TEXT DEFAULT 'per_unit'",
      water_per_unit_charge: "REAL DEFAULT 0",
      water_current_reading: "REAL DEFAULT 0",
      water_reading_date: "TEXT DEFAULT ''",
      water_fixed_amount: "REAL DEFAULT 0",
      water_last_reading: "REAL DEFAULT 0",
      water_last_reading_date: "TEXT DEFAULT ''",
      electricity_billing_type: "TEXT DEFAULT 'per_unit'",
      electricity_per_unit_charge: "REAL DEFAULT 10",
      electricity_current_reading: "REAL DEFAULT 0",
      electricity_reading_date: "TEXT DEFAULT ''",
      electricity_last_reading: "REAL DEFAULT 0",
      electricity_last_reading_date: "TEXT DEFAULT ''",
      electricity_fixed_amount: "REAL DEFAULT 0",
      eb_number: "TEXT DEFAULT ''",
    };
    for (const [colName, colDef] of Object.entries(extendedTenantCols)) {
      if (!tenantCols.includes(colName)) {
        await db.execAsync(`ALTER TABLE tenants ADD COLUMN ${colName} ${colDef};`);
      }
    }

    // Migrate payments table columns (total_amount, paid_amount)
    const paymentTableInfo = await db.getAllAsync<{ name: string }>(
      `PRAGMA table_info(payments)`
    );
    const paymentCols = paymentTableInfo.map((c) => c.name);

    if (!paymentCols.includes('total_amount')) {
      await db.execAsync(`ALTER TABLE payments ADD COLUMN total_amount REAL DEFAULT 0;`);
      await db.execAsync(`UPDATE payments SET total_amount = amount WHERE total_amount = 0 OR total_amount IS NULL;`);
    }
    if (!paymentCols.includes('paid_amount')) {
      await db.execAsync(`ALTER TABLE payments ADD COLUMN paid_amount REAL DEFAULT 0;`);
      await db.execAsync(`UPDATE payments SET paid_amount = amount WHERE status = 'Paid';`);
    }

    // Clean up legacy static mock seed records (June, July, August 2026 dummy data)
    try {
      await db.runAsync(
        `DELETE FROM payments 
         WHERE (month_year = 'June 2026' AND notes = 'Cash payment')
            OR (month_year = 'July 2026' AND notes = 'Paid via GPay')
            OR (month_year = 'August 2026' AND notes = 'Paid via UPI');`
      );
    } catch (cleanErr) {
      console.warn('[SQLite] Mock payment cleanup notice:', cleanErr);
    }

    // Backfill payment_transactions for existing paid payments if table is empty
    try {
      const txCountRes = await db.getFirstAsync<{ count: number }>(
        'SELECT COUNT(*) as count FROM payment_transactions'
      );
      if (!txCountRes || txCountRes.count === 0) {
        const paidRows = await db.getAllAsync<PaymentRecord>(
          "SELECT * FROM payments WHERE (status = 'Paid' OR paid_amount > 0) AND date_paid != ''"
        );
        for (const pr of paidRows) {
          const amt = pr.paid_amount || pr.total_amount || pr.amount;
          const cleanD = pr.date_paid.replace(/^Paid\s+/i, '').trim() || pr.month_year;
          await db.runAsync(
            `INSERT INTO payment_transactions (payment_id, property_id, flat_number, month_year, amount, date_paid, notes, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [pr.id, pr.property_id, pr.flat_number, pr.month_year, amt, cleanD, pr.notes || '', pr.created_at || new Date().toISOString()]
          );
        }
      }
    } catch (txMigErr) {
      console.warn('[SQLite] Transaction backfill notice:', txMigErr);
    }

    // Clean up legacy flat numbers like "Flat - Flat 1", "Flat - 1", "flat-flat1" to "Flat 1"
    try {
      // 1. Tenants
      const allTenants = await db.getAllAsync<{ id: number; flat_number: string }>(
        'SELECT id, flat_number FROM tenants'
      );
      for (const t of allTenants) {
        const cleaned = formatFlatNumber(t.flat_number);
        if (cleaned && cleaned !== t.flat_number) {
          await db.runAsync('UPDATE tenants SET flat_number = ? WHERE id = ?', [cleaned, t.id]);
        }
      }

      // 2. Payments
      const allPayments = await db.getAllAsync<{ id: number; flat_number: string }>(
        'SELECT id, flat_number FROM payments'
      );
      for (const p of allPayments) {
        const cleaned = formatFlatNumber(p.flat_number);
        if (cleaned && cleaned !== p.flat_number) {
          await db.runAsync('UPDATE payments SET flat_number = ? WHERE id = ?', [cleaned, p.id]);
        }
      }

      // 3. Payment Transactions
      const allTxs = await db.getAllAsync<{ id: number; flat_number: string }>(
        'SELECT id, flat_number FROM payment_transactions'
      );
      for (const tx of allTxs) {
        const cleaned = formatFlatNumber(tx.flat_number);
        if (cleaned && cleaned !== tx.flat_number) {
          await db.runAsync('UPDATE payment_transactions SET flat_number = ? WHERE id = ?', [cleaned, tx.id]);
        }
      }

      // 4. Flat EB Numbers
      const allEbs = await db.getAllAsync<{ property_id: number; flat_number: string; eb_number: string }>(
        'SELECT property_id, flat_number, eb_number FROM flat_eb_numbers'
      );
      for (const eb of allEbs) {
        const cleaned = formatFlatNumber(eb.flat_number);
        if (cleaned && cleaned !== eb.flat_number) {
          await db.runAsync(
            `INSERT INTO flat_eb_numbers (property_id, flat_number, eb_number, updated_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(property_id, flat_number) DO UPDATE SET eb_number = excluded.eb_number`,
            [eb.property_id, cleaned, eb.eb_number, new Date().toISOString()]
          );
          await db.runAsync(
            'DELETE FROM flat_eb_numbers WHERE property_id = ? AND flat_number = ?',
            [eb.property_id, eb.flat_number]
          );
        }
      }
    } catch (cleanFlatErr) {
      console.warn('[SQLite] Flat number normalization notice:', cleanFlatErr);
    }
  } catch (migErr) {
    console.warn('[SQLite] Column migration notice:', migErr);
  }
}

export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (dbInstance) {
    return dbInstance;
  }
  if (!initPromise) {
    initPromise = (async () => {
      try {
        const db = await SQLite.openDatabaseAsync('sls_properties.db');
        await ensureTables(db);
        dbInstance = db;
        return db;
      } catch (err) {
        initPromise = null;
        console.error('[SQLite] Database initialization failed:', err);
        throw err;
      }
    })();
  }
  return initPromise;
}

export async function initDatabaseAndTest(): Promise<DbTestResult> {
  try {
    const db = await getDatabase();

    // Perform a test insert (write)
    const now = new Date().toISOString();
    await db.runAsync(
      'INSERT INTO test_logs (message, created_at) VALUES (?, ?)',
      `SQLite connection verified successfully`,
      now
    );

    // Perform a test query (read)
    const allRecords = await db.getAllAsync<TestLogRecord>(
      'SELECT id, message, created_at FROM test_logs ORDER BY id DESC LIMIT 5'
    );

    const latest = allRecords[0];

    // Trigger silent cloud sync in the background
    notifyChange();

    return {
      success: true,
      message: 'SQLite database is active and read/write verified.',
      totalRecords: allRecords.length,
      latestRecord: latest,
    };
  } catch (error: any) {
    console.error('[SQLite] Error during initialization/test:', error);
    return {
      success: false,
      message: 'Failed to initialize SQLite database.',
      totalRecords: 0,
      error: error?.message || String(error),
    };
  }
}

export async function getAllProperties(): Promise<Property[]> {
  try {
    const db = await getDatabase();
    const rows = await db.getAllAsync<any>(
      'SELECT * FROM properties ORDER BY id DESC'
    );
    return rows.map((r) => ({
      id: r.id,
      building_name: r.building_name || r.name || '',
      building_address: r.building_address || r.address || '',
      location: r.location || '',
      units: Number(r.units) || 1,
      landlord_name: r.landlord_name || '',
      notes: r.notes || '',
      created_at: r.created_at || '',
      updated_at: r.updated_at || '',
    }));
  } catch (err) {
    console.error('[SQLite] getAllProperties error:', err);
    return [];
  }
}

export async function getPropertyById(id: number): Promise<Property | null> {
  try {
    const db = await getDatabase();
    const r = await db.getFirstAsync<any>(
      'SELECT * FROM properties WHERE id = ?',
      [id]
    );
    if (!r) return null;
    return {
      id: r.id,
      building_name: r.building_name || r.name || '',
      building_address: r.building_address || r.address || '',
      location: r.location || '',
      units: Number(r.units) || 1,
      landlord_name: r.landlord_name || '',
      notes: r.notes || '',
      created_at: r.created_at || '',
      updated_at: r.updated_at || '',
    };
  } catch (err) {
    console.error('[SQLite] getPropertyById error:', err);
    return null;
  }
}

export async function insertProperty(input: PropertyInput): Promise<number> {
  const db = await getDatabase();
  const now = new Date().toISOString();
  const result = await db.runAsync(
    `INSERT INTO properties (building_name, building_address, location, units, landlord_name, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      (input.building_name || '').trim(),
      (input.building_address || '').trim(),
      (input.location || '').trim(),
      Number(input.units) || 1,
      (input.landlord_name || '').trim(),
      (input.notes || '').trim(),
      now,
      now,
    ]
  );
  notifyChange();
  return result.lastInsertRowId;
}

export async function updateProperty(
  id: number,
  input: PropertyInput
): Promise<void> {
  const db = await getDatabase();
  const now = new Date().toISOString();
  await db.runAsync(
    `UPDATE properties 
     SET building_name = ?, building_address = ?, location = ?, units = ?, landlord_name = ?, notes = ?, updated_at = ?
     WHERE id = ?`,
    [
      (input.building_name || '').trim(),
      (input.building_address || '').trim(),
      (input.location || '').trim(),
      Number(input.units) || 1,
      (input.landlord_name || '').trim(),
      (input.notes || '').trim(),
      now,
      id,
    ]
  );
  notifyChange();
}

export async function deleteProperty(id: number): Promise<void> {
  try {
    const db = await getDatabase();
    await db.runAsync('DELETE FROM properties WHERE id = ?', [id]);
    await db.runAsync('DELETE FROM tenants WHERE property_id = ?', [id]);
    await db.runAsync('DELETE FROM payments WHERE property_id = ?', [id]);
    await db.runAsync('DELETE FROM payment_transactions WHERE property_id = ?', [id]);
    notifyPropertyDeleted(id);
    notifyChange();
  } catch (err) {
    console.error('[SQLite] deleteProperty error:', err);
    throw err;
  }
}

export async function getPropertyStats(): Promise<PropertyStats> {
  try {
    const db = await getDatabase();
    const row = await db.getFirstAsync<any>(
      `SELECT 
         COUNT(*) as count, 
         COALESCE(SUM(units), 0) as total_units 
       FROM properties`
    );
    return {
      totalProperties: Number(row?.count) || 0,
      totalUnits: Number(row?.total_units ?? row?.totalUnits) || 0,
    };
  } catch (err) {
    console.error('[SQLite] getPropertyStats error:', err);
    return {
      totalProperties: 0,
      totalUnits: 0,
    };
  }
}

// ---------------- TENANTS & FLATS MANAGEMENT ---------------- //

export async function getTenantsByProperty(
  propertyId: number
): Promise<Tenant[]> {
  try {
    const db = await getDatabase();
    return await db.getAllAsync<Tenant>(
      'SELECT * FROM tenants WHERE property_id = ? AND is_occupied = 1 ORDER BY id ASC',
      [propertyId]
    );
  } catch (err) {
    console.error('[SQLite] getTenantsByProperty error:', err);
    return [];
  }
}

export async function saveFlatEbNumber(
  propertyId: number,
  flatNumber: string,
  ebNumber: string
): Promise<void> {
  try {
    const db = await getDatabase();
    const now = new Date().toISOString();
    const cleanFlat = flatNumber.trim();
    const cleanEb = ebNumber.trim();
    if (!cleanEb) return;
    await db.runAsync(
      `INSERT INTO flat_eb_numbers (property_id, flat_number, eb_number, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(property_id, flat_number)
       DO UPDATE SET eb_number = excluded.eb_number, updated_at = excluded.updated_at`,
      [propertyId, cleanFlat, cleanEb, now]
    );
  } catch (err) {
    console.error('[SQLite] saveFlatEbNumber error:', err);
  }
}

export async function getFlatEbNumber(
  propertyId: number,
  flatNumber: string
): Promise<string> {
  try {
    const db = await getDatabase();
    const cleanFlat = flatNumber.trim();
    const row = await db.getFirstAsync<{ eb_number: string }>(
      'SELECT eb_number FROM flat_eb_numbers WHERE property_id = ? AND flat_number = ?',
      [propertyId, cleanFlat]
    );
    if (row && row.eb_number) return row.eb_number;

    const tRow = await db.getFirstAsync<{ eb_number: string }>(
      'SELECT eb_number FROM tenants WHERE property_id = ? AND flat_number = ? AND eb_number != ""',
      [propertyId, cleanFlat]
    );
    return tRow?.eb_number || '';
  } catch {
    return '';
  }
}

export async function getFlatsForProperty(
  propertyId: number,
  totalUnitsCount: number
): Promise<FlatItem[]> {
  try {
    const db = await getDatabase();
    const tenants = await db.getAllAsync<Tenant>(
      'SELECT * FROM tenants WHERE property_id = ? AND is_occupied = 1 ORDER BY id ASC',
      [propertyId]
    );

    const ebRows = await db.getAllAsync<{ flat_number: string; eb_number: string }>(
      'SELECT flat_number, eb_number FROM flat_eb_numbers WHERE property_id = ?',
      [propertyId]
    );
    const ebMap = new Map<string, string>();
    for (const r of ebRows) {
      if (r.eb_number) {
        ebMap.set(r.flat_number.trim().toLowerCase(), r.eb_number);
      }
    }

    const flats: FlatItem[] = [];
    const assignedTenantIds = new Set<number>();
    const count = Math.max(1, totalUnitsCount || 1);

    for (let i = 1; i <= count; i++) {
      const standardName = `Flat ${i}`;
      const alt2 = `${i}`;

      const matched = tenants.find((t) => {
        if (assignedTenantIds.has(t.id)) return false;
        const normT = formatFlatNumber(t.flat_number).toLowerCase();
        const std = standardName.toLowerCase();
        const rawT = t.flat_number.trim().toLowerCase();
        return (
          normT === std ||
          rawT === std ||
          rawT === alt2.toLowerCase() ||
          rawT === `flat-${i}` ||
          rawT === `flat-flat${i}` ||
          rawT === `flat - flat ${i}`
        );
      });

      const preservedEb =
        ebMap.get(standardName.toLowerCase()) ||
        ebMap.get(alt2.toLowerCase()) ||
        (matched ? ebMap.get(matched.flat_number.trim().toLowerCase()) : '') ||
        matched?.eb_number ||
        '';

      if (matched) {
        assignedTenantIds.add(matched.id);
        const normFlat = formatFlatNumber(matched.flat_number);
        flats.push({
          flat_number: normFlat,
          is_occupied: true,
          tenant: {
            ...matched,
            flat_number: normFlat,
            eb_number: matched.eb_number || preservedEb,
          },
          eb_number: preservedEb || matched.eb_number || '',
        });
      } else {
        flats.push({
          flat_number: standardName,
          is_occupied: false,
          eb_number: preservedEb,
        });
      }
    }

    // Include any tenants with custom flat names
    for (const t of tenants) {
      if (!assignedTenantIds.has(t.id)) {
        const normFlat = formatFlatNumber(t.flat_number);
        const preservedEb =
          ebMap.get(t.flat_number.trim().toLowerCase()) ||
          ebMap.get(normFlat.toLowerCase()) ||
          t.eb_number ||
          '';
        flats.push({
          flat_number: normFlat,
          is_occupied: true,
          tenant: {
            ...t,
            flat_number: normFlat,
            eb_number: t.eb_number || preservedEb,
          },
          eb_number: preservedEb,
        });
      }
    }

    return flats;
  } catch (err) {
    console.error('[SQLite] getFlatsForProperty error:', err);
    return [];
  }
}

export async function addOrUpdateTenant(input: TenantInput): Promise<number> {
  const db = await getDatabase();
  const now = new Date().toISOString();
  let tenantId = 0;

  const cleanFlat = formatFlatNumber(input.flat_number);
  const rawFlat = input.flat_number.trim();

  // Check if tenant exists for this flat
  const existing = await db.getFirstAsync<Tenant>(
    'SELECT * FROM tenants WHERE property_id = ? AND (flat_number = ? OR flat_number = ?) AND is_occupied = 1',
    [input.property_id, cleanFlat, rawFlat]
  );

  if (existing) {
    await db.runAsync(
      `UPDATE tenants 
       SET name = ?, phone_number = ?, occupation = ?, rent_amount = ?, due_day = ?, rent_start_date = ?, 
           rent_cycle = ?, maintenance_enabled = ?, maintenance_amount = ?,
           security_deposit_enabled = ?, security_deposit_amount = ?, security_deposit_date = ?,
           eb_number = ?,
           water_billing_type = ?, water_per_unit_charge = ?, water_current_reading = ?, water_reading_date = ?, water_fixed_amount = ?,
           electricity_billing_type = ?, electricity_per_unit_charge = ?, electricity_current_reading = ?, electricity_reading_date = ?, electricity_fixed_amount = ?,
           aadhar_id = ?, is_id_verified = ?, id_photo_uri = ?, updated_at = ?
       WHERE id = ?`,
      [
        input.name.trim(),
        input.phone_number.trim(),
        (input.occupation || '').trim(),
        Number(input.rent_amount) || 0,
        Number(input.due_day) || 1,
        (input.rent_start_date || '').trim(),
        input.rent_cycle || 'first_of_month',
        input.maintenance_enabled ? 1 : 0,
        Number(input.maintenance_amount) || 0,
        input.security_deposit_enabled ? 1 : 0,
        Number(input.security_deposit_amount) || 0,
        (input.security_deposit_date || '').trim(),
        (input.eb_number || '').trim(),
        input.water_billing_type || 'per_unit',
        Number(input.water_per_unit_charge) || 0,
        Number(input.water_current_reading) || 0,
        (input.water_reading_date || '').trim(),
        Number(input.water_fixed_amount) || 0,
        input.electricity_billing_type || 'per_unit',
        Number(input.electricity_per_unit_charge) || 10,
        Number(input.electricity_current_reading) || 0,
        (input.electricity_reading_date || '').trim(),
        Number(input.electricity_fixed_amount) || 0,
        (input.aadhar_id || '').trim(),
        input.is_id_verified ? 1 : 0,
        (input.id_photo_uri || '').trim(),
        now,
        existing.id,
      ]
    );
    tenantId = existing.id;
  } else {
    const result = await db.runAsync(
      `INSERT INTO tenants (
        property_id, flat_number, name, phone_number, occupation, rent_amount, due_day, rent_start_date,
        rent_cycle, maintenance_enabled, maintenance_amount,
        security_deposit_enabled, security_deposit_amount, security_deposit_date,
        eb_number,
        water_billing_type, water_per_unit_charge, water_current_reading, water_reading_date, water_fixed_amount,
        electricity_billing_type, electricity_per_unit_charge, electricity_current_reading, electricity_reading_date, electricity_fixed_amount,
        aadhar_id, is_id_verified, id_photo_uri, is_occupied, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      [
        input.property_id,
        cleanFlat,
        input.name.trim(),
        input.phone_number.trim(),
        (input.occupation || '').trim(),
        Number(input.rent_amount) || 0,
        Number(input.due_day) || 1,
        (input.rent_start_date || '').trim(),
        input.rent_cycle || 'first_of_month',
        input.maintenance_enabled ? 1 : 0,
        Number(input.maintenance_amount) || 0,
        input.security_deposit_enabled ? 1 : 0,
        Number(input.security_deposit_amount) || 0,
        (input.security_deposit_date || '').trim(),
        (input.eb_number || '').trim(),
        input.water_billing_type || 'per_unit',
        Number(input.water_per_unit_charge) || 0,
        Number(input.water_current_reading) || 0,
        (input.water_reading_date || '').trim(),
        Number(input.water_fixed_amount) || 0,
        input.electricity_billing_type || 'per_unit',
        Number(input.electricity_per_unit_charge) || 10,
        Number(input.electricity_current_reading) || 0,
        (input.electricity_reading_date || '').trim(),
        Number(input.electricity_fixed_amount) || 0,
        (input.aadhar_id || '').trim(),
        input.is_id_verified ? 1 : 0,
        (input.id_photo_uri || '').trim(),
        now,
        now,
      ]
    );
    tenantId = result.lastInsertRowId;
  }

  // Ensure initial payment record exists for this flat based on tenant's rent_start_date
  try {
    const rentAmount = Number(input.rent_amount) || 0;
    const dueDay = Number(input.due_day) || 5;
    const startDate = parseDateSafe(input.rent_start_date);
    const startMonthYear = getMonthYearFromDate(startDate);
    const dueDateStr = formatDueDateForMonth(startMonthYear, dueDay);

    const existingPayments = await db.getAllAsync<PaymentRecord>(
      'SELECT * FROM payments WHERE property_id = ? AND (flat_number = ? OR flat_number = ?)',
      [input.property_id, cleanFlat, rawFlat]
    );

    if (existingPayments.length === 0) {
      await db.runAsync(
        `INSERT INTO payments (property_id, flat_number, tenant_id, month_year, amount, total_amount, paid_amount, date_paid, due_date, notes, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, '', ?, '', 'Pending', ?, ?)`,
        [
          input.property_id,
          cleanFlat,
          tenantId,
          startMonthYear,
          rentAmount,
          rentAmount,
          dueDateStr,
          now,
          now,
        ]
      );
    } else if (
      existingPayments.length === 1 &&
      existingPayments[0].status === 'Pending' &&
      (existingPayments[0].paid_amount || 0) === 0
    ) {
      // If tenant modified start date before any payments were made, update the pending month
      await db.runAsync(
        `UPDATE payments 
         SET month_year = ?, amount = ?, total_amount = ?, due_date = ?, tenant_id = ?, updated_at = ?
         WHERE id = ?`,
        [
          startMonthYear,
          rentAmount,
          rentAmount,
          dueDateStr,
          tenantId,
          now,
          existingPayments[0].id,
        ]
      );
    }
  } catch (payInitErr) {
    console.warn('[SQLite] Error ensuring initial payment record on tenant save:', payInitErr);
  }

  // Save / update EB number in flat_eb_numbers so it persists across tenant vacating
  if (input.eb_number && input.eb_number.trim()) {
    await saveFlatEbNumber(input.property_id, input.flat_number.trim(), input.eb_number.trim());
  }

  notifyChange();
  return tenantId;
}

export async function removeTenantFromFlat(
  propertyId: number,
  flatNumber: string
): Promise<void> {
  const db = await getDatabase();
  const cleanFlat = flatNumber.trim();
  const normFlat = formatFlatNumber(cleanFlat);

  // Preserve the existing EB number before removing tenant so it is never lost on vacate
  try {
    const currentTenant = await db.getFirstAsync<{ eb_number: string }>(
      'SELECT eb_number FROM tenants WHERE property_id = ? AND (flat_number = ? OR flat_number = ?)',
      [propertyId, cleanFlat, normFlat]
    );
    if (currentTenant && currentTenant.eb_number && currentTenant.eb_number.trim()) {
      await saveFlatEbNumber(propertyId, normFlat, currentTenant.eb_number.trim());
    }
  } catch (ebErr) {
    console.warn('[SQLite] Error preserving EB number on vacate:', ebErr);
  }

  await db.runAsync(
    'DELETE FROM tenants WHERE property_id = ? AND (flat_number = ? OR flat_number = ?)',
    [propertyId, cleanFlat, normFlat]
  );
  // Clear payment history for this flat so the next tenant starts completely fresh
  await db.runAsync(
    'DELETE FROM payments WHERE property_id = ? AND (flat_number = ? OR flat_number = ?)',
    [propertyId, cleanFlat, normFlat]
  );
  await db.runAsync(
    'DELETE FROM payment_transactions WHERE property_id = ? AND (flat_number = ? OR flat_number = ?)',
    [propertyId, cleanFlat, normFlat]
  );
  notifyChange();
}

export async function removeTenantById(tenantId: number): Promise<void> {
  const db = await getDatabase();
  const tenant = await db.getFirstAsync<{ property_id: number; flat_number: string; eb_number?: string }>(
    'SELECT property_id, flat_number, eb_number FROM tenants WHERE id = ?',
    [tenantId]
  );
  if (tenant) {
    if (tenant.eb_number && tenant.eb_number.trim()) {
      try {
        await saveFlatEbNumber(tenant.property_id, tenant.flat_number.trim(), tenant.eb_number.trim());
      } catch (ebErr) {
        console.warn('[SQLite] Error preserving EB number on vacate by ID:', ebErr);
      }
    }
    await db.runAsync('DELETE FROM payments WHERE property_id = ? AND flat_number = ?', [
      tenant.property_id,
      tenant.flat_number,
    ]);
    await db.runAsync('DELETE FROM payment_transactions WHERE property_id = ? AND flat_number = ?', [
      tenant.property_id,
      tenant.flat_number,
    ]);
  }
  await db.runAsync('DELETE FROM tenants WHERE id = ?', [tenantId]);
  notifyTenantDeleted(tenantId);
  notifyChange();
}

export async function updateTenantMeterReadings(
  tenantId: number,
  electricityCurrent: number,
  electricityDate: string,
  waterCurrent: number,
  waterDate: string
): Promise<Tenant | null> {
  const db = await getDatabase();
  const current = await db.getFirstAsync<Tenant>('SELECT * FROM tenants WHERE id = ?', [tenantId]);
  if (!current) return null;

  const elecLast = current.electricity_current_reading || 0;
  const elecLastDate = current.electricity_reading_date || '';
  const waterLast = current.water_current_reading || 0;
  const waterLastDate = current.water_reading_date || '';

  const now = new Date().toISOString();
  await db.runAsync(
    `UPDATE tenants 
     SET electricity_last_reading = ?, electricity_last_reading_date = ?,
         electricity_current_reading = ?, electricity_reading_date = ?,
         water_last_reading = ?, water_last_reading_date = ?,
         water_current_reading = ?, water_reading_date = ?,
         updated_at = ?
     WHERE id = ?`,
    [
      elecLast,
      elecLastDate,
      Number(electricityCurrent) || 0,
      String(electricityDate || ''),
      waterLast,
      waterLastDate,
      Number(waterCurrent) || 0,
      String(waterDate || ''),
      now,
      tenantId,
    ]
  );

  return await db.getFirstAsync<Tenant>('SELECT * FROM tenants WHERE id = ?', [tenantId]);
}

// ---------------- DATE & MONTH UTILITIES ---------------- //

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export const MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const MONTH_MAP: { [key: string]: number } = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

export function parseDateSafe(dateStr?: string): Date {
  if (!dateStr || !dateStr.trim()) return new Date();
  const trimmed = dateStr.trim();

  // Try DD-MM-YYYY or DD-Mon-YYYY or YYYY-MM-DD
  const dashParts = trimmed.split('-');
  if (dashParts.length === 3) {
    if (dashParts[0].length === 4) {
      const year = parseInt(dashParts[0], 10);
      const month = parseInt(dashParts[1], 10) - 1;
      const day = parseInt(dashParts[2], 10);
      if (!isNaN(year) && !isNaN(month) && !isNaN(day)) {
        const d = new Date(year, month, day);
        if (!isNaN(d.getTime())) return d;
      }
    } else {
      const day = parseInt(dashParts[0], 10);
      const mStr = dashParts[1].toLowerCase().slice(0, 3);
      let month = MONTH_MAP[mStr];
      if (month === undefined) {
        month = parseInt(dashParts[1], 10) - 1;
      }
      const year = parseInt(dashParts[2], 10);
      if (!isNaN(day) && month !== undefined && !isNaN(month) && !isNaN(year)) {
        const d = new Date(year, month, day);
        if (!isNaN(d.getTime())) return d;
      }
    }
  }

  const fallback = new Date(trimmed);
  return isNaN(fallback.getTime()) ? new Date() : fallback;
}

export function getMonthYearFromDate(date: Date): string {
  return `${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
}

export function parseMonthYear(monthYear: string): { monthIndex: number; year: number } | null {
  if (!monthYear) return null;
  const parts = monthYear.trim().split(/\s+/);
  if (parts.length >= 2) {
    const mStr = parts[0].toLowerCase();
    const monthIndex = MONTH_NAMES.findIndex(
      (m, i) =>
        m.toLowerCase() === mStr ||
        MONTH_SHORT[i].toLowerCase() === mStr ||
        m.toLowerCase().startsWith(mStr.slice(0, 3))
    );
    const year = parseInt(parts[1], 10);
    if (monthIndex !== -1 && !isNaN(year)) {
      return { monthIndex, year };
    }
  }
  return null;
}

export function getNextMonthYear(monthYear: string): string {
  const parsed = parseMonthYear(monthYear);
  if (!parsed) {
    const now = new Date();
    const nextM = (now.getMonth() + 1) % 12;
    const nextY = nextM === 0 ? now.getFullYear() + 1 : now.getFullYear();
    return `${MONTH_NAMES[nextM]} ${nextY}`;
  }
  const nextMonthIndex = (parsed.monthIndex + 1) % 12;
  const nextYear = nextMonthIndex === 0 ? parsed.year + 1 : parsed.year;
  return `${MONTH_NAMES[nextMonthIndex]} ${nextYear}`;
}

export function formatDueDateForMonth(monthYear: string, dueDay: number): string {
  const parsed = parseMonthYear(monthYear);
  const dayStr = String(Math.max(1, Math.min(31, dueDay || 5))).padStart(2, '0');
  if (!parsed) {
    return `Due ${dayStr} ${MONTH_SHORT[new Date().getMonth()]}`;
  }
  return `Due ${dayStr} ${MONTH_SHORT[parsed.monthIndex]}`;
}

export function compareMonthYear(a: string, b: string): number {
  const pA = parseMonthYear(a);
  const pB = parseMonthYear(b);
  if (!pA || !pB) return 0;
  if (pA.year !== pB.year) return pA.year - pB.year;
  return pA.monthIndex - pB.monthIndex;
}

/**
 * Determines whether the rent for a given month_year is currently due to be calculated.
 * Rule: Rent for month M (e.g. September 2026) is only calculated/due starting from the 1st
 * of the following month (e.g. October 1, 2026). Prior to that date, pending balance is 0.
 */
export function isRentDue(monthYear: string, currentDate: Date = new Date()): boolean {
  const parsed = parseMonthYear(monthYear);
  if (!parsed) return true;

  const currentYear = currentDate.getFullYear();
  const currentMonth = currentDate.getMonth(); // 0-indexed (0 = Jan, 8 = Sep, 9 = Oct)
  const currentDay = currentDate.getDate();

  const dueYear = parsed.monthIndex === 11 ? parsed.year + 1 : parsed.year;
  const dueMonthIndex = (parsed.monthIndex + 1) % 12;
  const dueDay = 1;

  if (currentYear > dueYear) return true;
  if (currentYear < dueYear) return false;

  if (currentMonth > dueMonthIndex) return true;
  if (currentMonth < dueMonthIndex) return false;

  return currentDay >= dueDay;
}

/**
 * Calculates the next billing cycle start date for display (e.g. "01 Oct 2026").
 * If there is an unpaid due month, points to that cycle's due date (1st of next month).
 * If all due rent is cleared, points to the 1st of the month following the latest recorded month.
 */
export function computeNextStartDate(
  rentStartDate: string | undefined,
  dueDay: number | undefined,
  payments: PaymentRecord[] = []
): string {
  const day = String(dueDay || 1).padStart(2, '0');

  // 1. Find the earliest unpaid month that is currently due
  const dueUnpaid = payments
    .filter((p) => p.status !== 'Paid' && isRentDue(p.month_year))
    .sort((a, b) => compareMonthYear(a.month_year, b.month_year));

  if (dueUnpaid.length > 0) {
    const parsed = parseMonthYear(dueUnpaid[0].month_year);
    if (parsed) {
      const nextMonthIndex = (parsed.monthIndex + 1) % 12;
      const nextYear = nextMonthIndex === 0 ? parsed.year + 1 : parsed.year;
      return `${day} ${MONTH_SHORT[nextMonthIndex]} ${nextYear}`;
    }
  }

  // 2. If no due unpaid payments, check the latest payment record
  if (payments.length > 0) {
    const sortedAll = [...payments].sort((a, b) => compareMonthYear(a.month_year, b.month_year));
    const latest = sortedAll[sortedAll.length - 1];
    const parsed = parseMonthYear(latest.month_year);
    if (parsed) {
      const nextMonthIndex = (parsed.monthIndex + 1) % 12;
      const nextYear = nextMonthIndex === 0 ? parsed.year + 1 : parsed.year;
      return `${day} ${MONTH_SHORT[nextMonthIndex]} ${nextYear}`;
    }
  }

  // 3. Fallback to rent_start_date
  if (rentStartDate) {
    const start = parseDateSafe(rentStartDate);
    const nextMonthIndex = (start.getMonth() + 1) % 12;
    const nextYear = nextMonthIndex === 0 ? start.getFullYear() + 1 : start.getFullYear();
    return `${day} ${MONTH_SHORT[nextMonthIndex]} ${nextYear}`;
  }

  const now = new Date();
  const nextMonthIndex = (now.getMonth() + 1) % 12;
  const nextYear = nextMonthIndex === 0 ? now.getFullYear() + 1 : now.getFullYear();
  return `${day} ${MONTH_SHORT[nextMonthIndex]} ${nextYear}`;
}

// ---------------- PAYMENTS MANAGEMENT ---------------- //

export async function getPaymentsForFlat(
  propertyId: number,
  flatNumber: string,
  defaultRentAmount: number = 5000,
  dueDay: number = 5,
  rentStartDate?: string
): Promise<PaymentRecord[]> {
  const numPropId = Number(propertyId) || 0;
  const rawFlatNumber = String(flatNumber || '').trim();
  const cleanFlatNumber = formatFlatNumber(rawFlatNumber) || rawFlatNumber;

  if (!numPropId || !cleanFlatNumber) {
    return [];
  }

  try {
    const db = await getDatabase();
    const now = new Date().toISOString();

    // Look up active tenant for this flat
    const tenant = await db.getFirstAsync<Tenant>(
      'SELECT * FROM tenants WHERE property_id = ? AND (flat_number = ? OR flat_number = ?) AND is_occupied = 1',
      [numPropId, cleanFlatNumber, rawFlatNumber]
    );
    const effectiveRent = Number(tenant?.rent_amount || defaultRentAmount) || 5000;
    const effectiveDueDay = Number(tenant?.due_day || dueDay) || 5;
    const effectiveStartDate = String(tenant?.rent_start_date || rentStartDate || '');

    let records = await db.getAllAsync<PaymentRecord>(
      'SELECT * FROM payments WHERE property_id = ? AND (flat_number = ? OR flat_number = ?) ORDER BY id DESC',
      [numPropId, cleanFlatNumber, rawFlatNumber]
    );

    // If no payment history exists yet, generate a single initial month record from rent_start_date
    if (records.length === 0) {
      const startDate = parseDateSafe(effectiveStartDate);
      const startMonthYear = String(getMonthYearFromDate(startDate));
      const dueDateStr = String(formatDueDateForMonth(startMonthYear, effectiveDueDay));
      const tenantId = tenant ? Number(tenant.id) || 0 : 0;

      await db.runAsync(
        `INSERT INTO payments (property_id, flat_number, tenant_id, month_year, amount, total_amount, paid_amount, date_paid, due_date, notes, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, '', ?, '', 'Pending', ?, ?)`,
        [
          numPropId,
          cleanFlatNumber,
          tenantId,
          startMonthYear,
          effectiveRent,
          effectiveRent,
          dueDateStr,
          now,
          now,
        ]
      );

      records = await db.getAllAsync<PaymentRecord>(
        'SELECT * FROM payments WHERE property_id = ? AND flat_number = ? ORDER BY id DESC',
        [numPropId, cleanFlatNumber]
      );
    } else {
      // If there is only 1 pending record with 0 payments and tenant has a rent_start_date, align it
      if (
        records.length === 1 &&
        records[0].status === 'Pending' &&
        (records[0].paid_amount || 0) === 0 &&
        effectiveStartDate
      ) {
        const expectedMonth = String(getMonthYearFromDate(parseDateSafe(effectiveStartDate)));
        if (records[0].month_year !== expectedMonth) {
          const expectedDueDate = String(formatDueDateForMonth(expectedMonth, effectiveDueDay));
          const recTenantId = tenant ? Number(tenant.id) || 0 : Number(records[0].tenant_id) || 0;
          await db.runAsync(
            `UPDATE payments 
             SET month_year = ?, due_date = ?, amount = ?, total_amount = ?, tenant_id = ?, updated_at = ?
             WHERE id = ?`,
            [
              expectedMonth,
              expectedDueDate,
              effectiveRent,
              effectiveRent,
              recTenantId,
              now,
              Number(records[0].id),
            ]
          );

          records = await db.getAllAsync<PaymentRecord>(
            'SELECT * FROM payments WHERE property_id = ? AND flat_number = ? ORDER BY id DESC',
            [numPropId, cleanFlatNumber]
          );
        }
      }

      // Ensure all elapsed calendar months up to the current month exist as Pending records
      const currentMonthYear = getMonthYearFromDate(new Date());
      let sorted = [...records].sort((a, b) => compareMonthYear(a.month_year, b.month_year));
      let lastMonthRec = sorted[sorted.length - 1];

      while (lastMonthRec && compareMonthYear(lastMonthRec.month_year, currentMonthYear) < 0) {
        const nextMonth = String(getNextMonthYear(lastMonthRec.month_year));
        const exists = records.some(
          (r) => r.month_year.trim().toLowerCase() === nextMonth.trim().toLowerCase()
        );
        if (!exists) {
          const nextDueDate = String(formatDueDateForMonth(nextMonth, effectiveDueDay));
          const nextTenantId = tenant ? Number(tenant.id) || 0 : 0;
          await db.runAsync(
            `INSERT INTO payments (property_id, flat_number, tenant_id, month_year, amount, total_amount, paid_amount, date_paid, due_date, notes, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, 0, '', ?, '', 'Pending', ?, ?)`,
            [
              numPropId,
              cleanFlatNumber,
              nextTenantId,
              nextMonth,
              effectiveRent,
              effectiveRent,
              nextDueDate,
              now,
              now,
            ]
          );

          records = await db.getAllAsync<PaymentRecord>(
            'SELECT * FROM payments WHERE property_id = ? AND flat_number = ? ORDER BY id DESC',
            [numPropId, cleanFlatNumber]
          );
          sorted = [...records].sort((a, b) => compareMonthYear(a.month_year, b.month_year));
          lastMonthRec = sorted[sorted.length - 1];
        } else {
          break;
        }
      }

      // If the latest chronological month is Paid, and the next month is missing, spawn the next month as Pending
      sorted = [...records].sort((a, b) => compareMonthYear(a.month_year, b.month_year));
      const latest = sorted[sorted.length - 1];
      if (latest && latest.status === 'Paid') {
        const nextMonth = String(getNextMonthYear(latest.month_year));
        const exists = records.some(
          (r) => r.month_year.trim().toLowerCase() === nextMonth.trim().toLowerCase()
        );
        if (!exists) {
          const nextDueDate = String(formatDueDateForMonth(nextMonth, effectiveDueDay));
          const nextTenantId = tenant ? Number(tenant.id) || 0 : 0;
          await db.runAsync(
            `INSERT INTO payments (property_id, flat_number, tenant_id, month_year, amount, total_amount, paid_amount, date_paid, due_date, notes, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, 0, '', ?, '', 'Pending', ?, ?)`,
            [
              numPropId,
              cleanFlatNumber,
              nextTenantId,
              nextMonth,
              effectiveRent,
              effectiveRent,
              nextDueDate,
              now,
              now,
            ]
          );

          records = await db.getAllAsync<PaymentRecord>(
            'SELECT * FROM payments WHERE property_id = ? AND flat_number = ? ORDER BY id DESC',
            [numPropId, cleanFlatNumber]
          );
        }
      }
    }

    let allTx: PaymentTransaction[] = [];
    try {
      allTx = await db.getAllAsync<PaymentTransaction>(
        'SELECT * FROM payment_transactions WHERE property_id = ? AND flat_number = ? ORDER BY id ASC',
        [numPropId, cleanFlatNumber]
      );
    } catch {
      allTx = [];
    }

    return records.map((r) => {
      const total = Number(r.total_amount || r.amount || effectiveRent) || effectiveRent;
      const paid = r.paid_amount !== undefined
        ? Number(r.paid_amount) || 0
        : (r.status === 'Paid' ? total : 0);
      let txList = allTx.filter(
        (t) => t.payment_id === r.id || t.month_year.trim().toLowerCase() === r.month_year.trim().toLowerCase()
      );
      if (txList.length === 0 && (r.status === 'Paid' || (r.paid_amount !== undefined && r.paid_amount > 0))) {
        const cleanD = r.date_paid ? r.date_paid.replace(/^Paid\s+/i, '').trim() : '';
        txList = [
          {
            id: 0,
            payment_id: r.id,
            property_id: r.property_id,
            flat_number: r.flat_number,
            month_year: r.month_year,
            amount: paid > 0 ? paid : total,
            date_paid: cleanD || r.month_year,
            notes: r.notes || '',
            created_at: r.created_at || '',
          },
        ];
      }
      return {
        ...r,
        total_amount: total,
        paid_amount: paid,
        transactions: txList,
      };
    });
  } catch (err) {
    console.error('[SQLite] getPaymentsForFlat error:', err);
    dbInstance = null;
    initPromise = null;
    return [];
  }
}

export interface PaymentDistributionResult {
  id: number;
  status: 'Paid' | 'Partial' | 'Pending';
  totalAmount: number;
  paidAmount: number;
  balance: number;
  nextMonthCreated?: string;
  affectedMonths?: Array<{
    month: string;
    amountApplied: number;
    status: 'Paid' | 'Partial' | 'Pending';
  }>;
}

export async function markPaymentAsPaid(
  propertyId: number,
  flatNumber: string,
  monthYear: string,
  amountPayingNow: number,
  datePaid: string,
  notes: string = '',
  expectedTotalRent: number = 5000
): Promise<PaymentDistributionResult> {
  const db = await getDatabase();
  const now = new Date().toISOString();
  const rawFlatNumber = flatNumber.trim();
  const cleanFlatNumber = formatFlatNumber(rawFlatNumber) || rawFlatNumber;
  const cleanTargetMonth = monthYear.trim();

  // Find tenant info for rent_amount and due_day
  const tenant = await db.getFirstAsync<Tenant>(
    'SELECT * FROM tenants WHERE property_id = ? AND (flat_number = ? OR flat_number = ?) AND is_occupied = 1',
    [propertyId, cleanFlatNumber, rawFlatNumber]
  );
  const tenantRent = Number(tenant?.rent_amount || expectedTotalRent) || 5000;
  const dueDay = Number(tenant?.due_day || 5) || 5;
  const tenantId = tenant ? Number(tenant.id) || 0 : 0;

  // Retrieve existing payment records for this flat
  const existingRecords = await db.getAllAsync<PaymentRecord>(
    'SELECT * FROM payments WHERE property_id = ? AND (flat_number = ? OR flat_number = ?)',
    [propertyId, cleanFlatNumber, rawFlatNumber]
  );

  // Find all unpaid or partially paid records, sorted chronologically
  const unpaidRecords = existingRecords
    .filter((r) => r.status === 'Pending' || r.status === 'Partial' || (r.paid_amount !== undefined && r.paid_amount < (r.total_amount || r.amount || tenantRent)))
    .sort((a, b) => compareMonthYear(a.month_year, b.month_year));

  // Determine starting month:
  // If there are unpaid records earlier than or equal to the target month, start from the earliest unpaid month!
  let startingMonth = cleanTargetMonth;
  if (unpaidRecords.length > 0) {
    const earliestUnpaid = unpaidRecords[0];
    if (compareMonthYear(earliestUnpaid.month_year, cleanTargetMonth) <= 0) {
      startingMonth = earliestUnpaid.month_year;
    }
  }

  let remainingMoney = Number(amountPayingNow) || 0;
  let currentMonth = startingMonth;
  const affectedMonths: Array<{ month: string; amountApplied: number; status: 'Paid' | 'Partial' | 'Pending' }> = [];

  let lastRecordId = 0;
  let lastStatus: 'Paid' | 'Partial' | 'Pending' = 'Pending';
  let lastTotal = tenantRent;
  let lastPaid = 0;
  let lastBalance = 0;

  const cleanDate = datePaid.trim().replace(/^Paid\s+/i, '');
  const displayPaidDate = cleanDate ? `Paid ${cleanDate}` : '';

  while (remainingMoney > 0) {
    let rec = await db.getFirstAsync<PaymentRecord>(
      'SELECT * FROM payments WHERE property_id = ? AND flat_number = ? AND month_year = ?',
      [propertyId, cleanFlatNumber, currentMonth]
    );

    if (!rec) {
      const nextDueDate = formatDueDateForMonth(currentMonth, dueDay);
      const res = await db.runAsync(
        `INSERT INTO payments (property_id, flat_number, tenant_id, month_year, amount, total_amount, paid_amount, date_paid, due_date, notes, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, '', ?, '', 'Pending', ?, ?)`,
        [propertyId, cleanFlatNumber, tenantId, currentMonth, tenantRent, tenantRent, nextDueDate, now, now]
      );
      rec = {
        id: res.lastInsertRowId,
        property_id: propertyId,
        flat_number: cleanFlatNumber,
        tenant_id: tenantId,
        month_year: currentMonth,
        amount: tenantRent,
        total_amount: tenantRent,
        paid_amount: 0,
        date_paid: '',
        due_date: nextDueDate,
        notes: '',
        status: 'Pending',
        created_at: now,
        updated_at: now,
      };
    }

    const totalForMonth = Number(rec.total_amount || rec.amount || tenantRent) || tenantRent;
    const currentPaidForMonth = rec.paid_amount !== undefined
      ? Number(rec.paid_amount) || 0
      : (rec.status === 'Paid' ? totalForMonth : 0);

    const neededForMonth = Math.max(0, totalForMonth - currentPaidForMonth);

    if (neededForMonth === 0) {
      // This month is already fully paid, move to next month
      currentMonth = getNextMonthYear(currentMonth);
      continue;
    }

    const applyAmount = Math.min(remainingMoney, neededForMonth);
    const newPaidAmount = currentPaidForMonth + applyAmount;
    const newStatus: 'Paid' | 'Partial' | 'Pending' =
      newPaidAmount >= totalForMonth ? 'Paid' : newPaidAmount > 0 ? 'Partial' : 'Pending';

    const monthNotes = notes.trim();

    await db.runAsync(
      `UPDATE payments 
       SET status = ?, amount = ?, total_amount = ?, paid_amount = ?, date_paid = ?, notes = ?, updated_at = ?
       WHERE id = ?`,
      [newStatus, totalForMonth, totalForMonth, newPaidAmount, displayPaidDate, monthNotes, now, rec.id]
    );

    // Record this payment installment / split in payment_transactions
    await db.runAsync(
      `INSERT INTO payment_transactions (payment_id, property_id, flat_number, month_year, amount, date_paid, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [rec.id, propertyId, cleanFlatNumber, currentMonth, applyAmount, cleanDate, monthNotes, now]
    );

    affectedMonths.push({
      month: currentMonth,
      amountApplied: applyAmount,
      status: newStatus,
    });

    remainingMoney -= applyAmount;
    lastRecordId = rec.id;
    lastStatus = newStatus;
    lastTotal = totalForMonth;
    lastPaid = newPaidAmount;
    lastBalance = Math.max(0, totalForMonth - newPaidAmount);

    // Move to next month for potential overflow
    currentMonth = getNextMonthYear(currentMonth);
  }

  // If the last affected month was fully Paid, ensure the next month exists as Pending
  let nextMonthCreated: string | undefined;
  const lastAffected = affectedMonths[affectedMonths.length - 1];
  if (lastAffected && lastAffected.status === 'Paid') {
    const nextMonth = getNextMonthYear(lastAffected.month);
    const existingNext = await db.getFirstAsync<PaymentRecord>(
      'SELECT * FROM payments WHERE property_id = ? AND flat_number = ? AND month_year = ?',
      [propertyId, cleanFlatNumber, nextMonth]
    );

    if (!existingNext) {
      const nextDueDate = formatDueDateForMonth(nextMonth, dueDay);
      await db.runAsync(
        `INSERT INTO payments (property_id, flat_number, tenant_id, month_year, amount, total_amount, paid_amount, date_paid, due_date, notes, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, '', ?, '', 'Pending', ?, ?)`,
        [propertyId, cleanFlatNumber, tenantId, nextMonth, tenantRent, tenantRent, nextDueDate, now, now]
      );
      nextMonthCreated = nextMonth;
    }
  }

  notifyChange();

  return {
    id: lastRecordId,
    status: lastStatus,
    totalAmount: lastTotal,
    paidAmount: lastPaid,
    balance: lastBalance,
    nextMonthCreated,
    affectedMonths,
  };
}

export async function updatePaymentRecord(
  propertyId: number,
  flatNumber: string,
  monthYear: string,
  newAmount: number,
  newDatePaid: string,
  newNotes: string = '',
  transactionId?: number
): Promise<void> {
  const db = await getDatabase();
  const now = new Date().toISOString();

  const existing = await db.getFirstAsync<PaymentRecord>(
    'SELECT * FROM payments WHERE property_id = ? AND flat_number = ? AND month_year = ?',
    [propertyId, flatNumber.trim(), monthYear.trim()]
  );

  if (!existing) {
    throw new Error('Payment record not found to update');
  }

  const cleanDate = newDatePaid.trim().replace(/^Paid\s+/i, '');
  const displayPaidDate = cleanDate ? `Paid ${cleanDate}` : '';

  if (transactionId && transactionId > 0) {
    await db.runAsync(
      `UPDATE payment_transactions 
       SET amount = ?, date_paid = ?, notes = ? 
       WHERE id = ?`,
      [newAmount, cleanDate, newNotes.trim(), transactionId]
    );
  } else {
    const txs = await db.getAllAsync<PaymentTransaction>(
      'SELECT * FROM payment_transactions WHERE property_id = ? AND flat_number = ? AND month_year = ? ORDER BY id ASC',
      [propertyId, flatNumber.trim(), monthYear.trim()]
    );

    if (txs.length === 1) {
      await db.runAsync(
        `UPDATE payment_transactions 
         SET amount = ?, date_paid = ?, notes = ? 
         WHERE id = ?`,
        [newAmount, cleanDate, newNotes.trim(), txs[0].id]
      );
    } else if (txs.length === 0) {
      await db.runAsync(
        `INSERT INTO payment_transactions (payment_id, property_id, flat_number, month_year, amount, date_paid, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [existing.id, propertyId, flatNumber.trim(), monthYear.trim(), newAmount, cleanDate, newNotes.trim(), now]
      );
    }
  }

  // Calculate new total paid from all transactions
  const txSum = await db.getFirstAsync<{ sum: number }>(
    'SELECT SUM(amount) as sum FROM payment_transactions WHERE property_id = ? AND flat_number = ? AND month_year = ?',
    [propertyId, flatNumber.trim(), monthYear.trim()]
  );

  const totalAmount = existing.total_amount || existing.amount || 5000;
  const newPaidAmount = txSum && txSum.sum !== null ? Number(txSum.sum) : newAmount;
  const newStatus: 'Paid' | 'Partial' | 'Pending' =
    newPaidAmount >= totalAmount ? 'Paid' : newPaidAmount > 0 ? 'Partial' : 'Pending';

  const latestTx = await db.getFirstAsync<PaymentTransaction>(
    'SELECT * FROM payment_transactions WHERE property_id = ? AND flat_number = ? AND month_year = ? ORDER BY id DESC',
    [propertyId, flatNumber.trim(), monthYear.trim()]
  );
  const finalPaidDate = latestTx?.date_paid ? `Paid ${latestTx.date_paid.replace(/^Paid\s+/i, '').trim()}` : displayPaidDate;
  const finalNotes = latestTx?.notes !== undefined ? latestTx.notes : newNotes.trim();

  await db.runAsync(
    `UPDATE payments 
     SET paid_amount = ?, status = ?, date_paid = ?, notes = ?, updated_at = ?
     WHERE id = ?`,
    [newPaidAmount, newStatus, finalPaidDate, finalNotes, now, existing.id]
  );

  // If status reached 'Paid', ensure next month exists as Pending
  if (newStatus === 'Paid') {
    const nextMonth = getNextMonthYear(monthYear.trim());
    const existingNext = await db.getFirstAsync<PaymentRecord>(
      'SELECT * FROM payments WHERE property_id = ? AND flat_number = ? AND month_year = ?',
      [propertyId, flatNumber.trim(), nextMonth]
    );

    if (!existingNext) {
      const tenant = await db.getFirstAsync<Tenant>(
        'SELECT * FROM tenants WHERE property_id = ? AND flat_number = ? AND is_occupied = 1',
        [propertyId, flatNumber.trim()]
      );
      const nextRentAmount = tenant?.rent_amount || totalAmount;
      const dueDay = tenant?.due_day || 5;
      const nextDueDate = formatDueDateForMonth(nextMonth, dueDay);

      await db.runAsync(
        `INSERT INTO payments (property_id, flat_number, tenant_id, month_year, amount, total_amount, paid_amount, date_paid, due_date, notes, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, '', ?, '', 'Pending', ?, ?)`,
        [
          propertyId,
          flatNumber.trim(),
          tenant?.id || 0,
          nextMonth,
          nextRentAmount,
          nextRentAmount,
          nextDueDate,
          now,
          now,
        ]
      );
    }
  }

  notifyChange();
}

export async function deletePaymentTransaction(
  transactionId: number,
  propertyId: number,
  flatNumber: string,
  monthYear: string
): Promise<void> {
  const db = await getDatabase();
  const now = new Date().toISOString();

  await db.runAsync('DELETE FROM payment_transactions WHERE id = ?', [transactionId]);

  const existing = await db.getFirstAsync<PaymentRecord>(
    'SELECT * FROM payments WHERE property_id = ? AND flat_number = ? AND month_year = ?',
    [propertyId, flatNumber.trim(), monthYear.trim()]
  );

  if (existing) {
    const txSum = await db.getFirstAsync<{ sum: number }>(
      'SELECT SUM(amount) as sum FROM payment_transactions WHERE property_id = ? AND flat_number = ? AND month_year = ?',
      [propertyId, flatNumber.trim(), monthYear.trim()]
    );
    const newPaidAmount = txSum && txSum.sum !== null ? Number(txSum.sum) : 0;
    const totalAmount = existing.total_amount || existing.amount || 5000;
    const newStatus: 'Paid' | 'Partial' | 'Pending' =
      newPaidAmount >= totalAmount ? 'Paid' : newPaidAmount > 0 ? 'Partial' : 'Pending';

    const latestTx = await db.getFirstAsync<PaymentTransaction>(
      'SELECT * FROM payment_transactions WHERE property_id = ? AND flat_number = ? AND month_year = ? ORDER BY id DESC',
      [propertyId, flatNumber.trim(), monthYear.trim()]
    );
    const finalPaidDate = latestTx?.date_paid ? `Paid ${latestTx.date_paid.replace(/^Paid\s+/i, '').trim()}` : '';
    const finalNotes = latestTx?.notes || '';

    await db.runAsync(
      `UPDATE payments 
       SET paid_amount = ?, status = ?, date_paid = ?, notes = ?, updated_at = ?
       WHERE id = ?`,
      [newPaidAmount, newStatus, finalPaidDate, finalNotes, now, existing.id]
    );
  }

  notifyChange();
}

export async function deleteFullPayment(
  propertyId: number,
  flatNumber: string,
  monthYear: string
): Promise<void> {
  const db = await getDatabase();
  const now = new Date().toISOString();

  // 1. Delete all transactions for this payment / month
  await db.runAsync(
    'DELETE FROM payment_transactions WHERE property_id = ? AND flat_number = ? AND month_year = ?',
    [propertyId, flatNumber.trim(), monthYear.trim()]
  );

  // 2. Reset the payment record for this month to Pending with 0 paid
  await db.runAsync(
    `UPDATE payments 
     SET paid_amount = 0, status = 'Pending', date_paid = '', notes = '', updated_at = ?
     WHERE property_id = ? AND flat_number = ? AND month_year = ?`,
    [now, propertyId, flatNumber.trim(), monthYear.trim()]
  );

  // 3. If the chronologically next month was spawned as Pending with 0 payments, clean it up
  const nextMonth = getNextMonthYear(monthYear.trim());
  const nextRec = await db.getFirstAsync<PaymentRecord>(
    'SELECT * FROM payments WHERE property_id = ? AND flat_number = ? AND month_year = ?',
    [propertyId, flatNumber.trim(), nextMonth]
  );
  if (nextRec && nextRec.status === 'Pending' && (nextRec.paid_amount || 0) === 0) {
    const nextTxCount = await db.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) as count FROM payment_transactions WHERE property_id = ? AND flat_number = ? AND month_year = ?',
      [propertyId, flatNumber.trim(), nextMonth]
    );
    if (!nextTxCount || nextTxCount.count === 0) {
      await db.runAsync('DELETE FROM payments WHERE id = ?', [nextRec.id]);
      notifyPaymentDeleted(nextRec.id);
    }
  }

  notifyChange();
}

export async function getAllPaymentsForProperty(propertyId: number): Promise<PaymentRecord[]> {
  try {
    const db = await getDatabase();
    const now = new Date().toISOString();

    // Ensure all occupied flats have their payments initialized and synchronized
    const occupiedTenants = await db.getAllAsync<Tenant>(
      'SELECT * FROM tenants WHERE property_id = ? AND is_occupied = 1',
      [propertyId]
    );
    for (const t of occupiedTenants) {
      await getPaymentsForFlat(
        propertyId,
        t.flat_number,
        t.rent_amount || 5000,
        t.due_day || 5,
        t.rent_start_date
      );
    }

    const records = await db.getAllAsync<PaymentRecord>(
      'SELECT * FROM payments WHERE property_id = ? ORDER BY id DESC',
      [propertyId]
    );

    let allTx: PaymentTransaction[] = [];
    try {
      allTx = await db.getAllAsync<PaymentTransaction>(
        'SELECT * FROM payment_transactions WHERE property_id = ? ORDER BY id ASC',
        [propertyId]
      );
    } catch {
      allTx = [];
    }

    return records.map((r) => {
      const total = r.total_amount || r.amount || 0;
      const paid = r.paid_amount !== undefined ? r.paid_amount : (r.status === 'Paid' ? total : 0);
      const txs = allTx.filter((t) => t.payment_id === r.id);
      return {
        ...r,
        total_amount: total,
        paid_amount: paid,
        transactions: txs,
      };
    });
  } catch (err) {
    console.error('[SQLite] getAllPaymentsForProperty error:', err);
    return [];
  }
}

// ---------------- RENT REPORT MANAGEMENT ---------------- //

export type RentReportMonthStatus = 'paid' | 'not_paid' | 'partial' | 'upcoming';

export interface RentReportMonthData {
  status: RentReportMonthStatus;
  record?: PaymentRecord;
}

export interface RentReportTenantRow {
  tenant: Tenant;
  displayFlat: string;
  months: {
    [monthIndex: number]: RentReportMonthData;
  };
}

export interface RentReportResult {
  property: Property | null;
  year: number;
  rows: RentReportTenantRow[];
}

export interface PropertyWithCounts extends Property {
  occupiedCount: number;
}

export interface ConsolidatedBuildingReport {
  property: PropertyWithCounts;
  report: RentReportResult;
  totalPaid: number;
  totalPending: number;
  monthlyCollected: number[];
  monthlyDue: number[];
}

export interface ConsolidatedRentReportResult {
  year: number;
  buildings: ConsolidatedBuildingReport[];
  totalTenants: number;
  totalUnits: number;
  totalPaid: number;
  totalPending: number;
  monthlyCollected: number[];
  monthlyDue: number[];
}

export async function getPropertiesWithCounts(): Promise<PropertyWithCounts[]> {
  try {
    const db = await getDatabase();
    const properties = await getAllProperties();
    const result: PropertyWithCounts[] = [];
    for (const p of properties) {
      const occupiedRes = await db.getFirstAsync<{ count: number }>(
        'SELECT COUNT(*) as count FROM tenants WHERE property_id = ? AND is_occupied = 1',
        [p.id]
      );
      result.push({
        ...p,
        occupiedCount: occupiedRes?.count || 0,
      });
    }
    return result;
  } catch (err) {
    console.error('[SQLite] getPropertiesWithCounts error:', err);
    return [];
  }
}

export async function getRentReportForProperty(
  propertyId: number,
  year: number
): Promise<RentReportResult> {
  try {
    const db = await getDatabase();
    const prop = await getPropertyById(propertyId);

    // Get occupied tenants for this property
    const tenants = await db.getAllAsync<Tenant>(
      'SELECT * FROM tenants WHERE property_id = ? AND is_occupied = 1 ORDER BY id ASC',
      [propertyId]
    );

    // Natural sort tenants by flat number (e.g., Flat 1, Flat 2, Flat 10)
    const extractNum = (s: string) => {
      const m = s.match(/\d+/);
      return m ? parseInt(m[0], 10) : 999999;
    };
    tenants.sort((a, b) => {
      const numA = extractNum(a.flat_number);
      const numB = extractNum(b.flat_number);
      if (numA !== numB) return numA - numB;
      return a.flat_number.localeCompare(b.flat_number);
    });

    // Get all payments for this property (ensures initial records exist)
    const allPayments = await getAllPaymentsForProperty(propertyId);

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    const rows: RentReportTenantRow[] = tenants.map((t) => {
      const displayFlat = formatFlatNumber(t.flat_number);

      // Filter payments belonging to this tenant
      const tenantPayments = allPayments.filter(
        (p) =>
          p.tenant_id === t.id ||
          formatFlatNumber(p.flat_number).toLowerCase() === displayFlat.toLowerCase() ||
          p.flat_number.trim().toLowerCase() === t.flat_number.trim().toLowerCase()
      );

      // Rent start date parsing
      const startDate = t.rent_start_date ? parseDateSafe(t.rent_start_date) : null;
      const startYear = startDate ? startDate.getFullYear() : null;
      const startMonth = startDate ? startDate.getMonth() : null;

      const monthsMap: RentReportTenantRow['months'] = {};

      for (let mIdx = 0; mIdx < 12; mIdx++) {
        // Check if month is prior to tenant moving in
        const isBeforeTenancy =
          startYear !== null &&
          startMonth !== null &&
          (year < startYear || (year === startYear && mIdx < startMonth));

        // Find payment record for this month & year
        const record = tenantPayments.find((p) => {
          const parsed = parseMonthYear(p.month_year);
          return parsed && parsed.year === year && parsed.monthIndex === mIdx;
        });

        const isPendingNotDue =
          year > currentYear || (year === currentYear && mIdx >= currentMonth);

        let status: RentReportMonthStatus;

        if (record) {
          const total = record.total_amount || record.amount || 0;
          const paid = record.paid_amount !== undefined ? record.paid_amount : (record.status === 'Paid' ? total : 0);

          if (record.status === 'Paid' || (total > 0 && paid >= total)) {
            status = 'paid';
          } else if (record.status === 'Partial' || (paid > 0 && paid < total)) {
            status = 'partial';
          } else {
            // Pending in DB: if month is not yet due (current or future month), show upcoming, else not_paid
            status = isPendingNotDue ? 'upcoming' : 'not_paid';
          }
        } else {
          // No record in DB
          if (isBeforeTenancy || isPendingNotDue) {
            status = 'upcoming';
          } else {
            status = 'not_paid';
          }
        }

        monthsMap[mIdx] = {
          status,
          record,
        };
      }

      return {
        tenant: t,
        displayFlat,
        months: monthsMap,
      };
    });

    return {
      property: prop,
      year,
      rows,
    };
  } catch (err) {
    console.error('[SQLite] getRentReportForProperty error:', err);
    return {
      property: null,
      year,
      rows: [],
    };
  }
}

export async function getAllBuildingsRentReport(
  year: number
): Promise<ConsolidatedRentReportResult> {
  try {
    const properties = await getPropertiesWithCounts();
    const buildings: ConsolidatedBuildingReport[] = [];
    const overallMonthlyCollected: number[] = new Array(12).fill(0);
    const overallMonthlyDue: number[] = new Array(12).fill(0);
    let overallTotalPaid = 0;
    let overallTotalPending = 0;
    let overallTotalTenants = 0;
    let overallTotalUnits = 0;

    for (const prop of properties) {
      const report = await getRentReportForProperty(prop.id, year);
      overallTotalUnits += prop.units || 0;
      overallTotalTenants += report.rows.length;

      const bMonthlyCollected: number[] = new Array(12).fill(0);
      const bMonthlyDue: number[] = new Array(12).fill(0);
      let bTotalPaid = 0;
      let bTotalPending = 0;

      for (const row of report.rows) {
        const rent = row.tenant.rent_amount || 0;
        for (let mIdx = 0; mIdx < 12; mIdx++) {
          const monthData = row.months[mIdx];
          const status = monthData?.status || 'upcoming';
          const totalAmount = monthData?.record?.total_amount ?? monthData?.record?.amount ?? rent;

          let paid = 0;
          let due = 0;
          if (status === 'paid') {
            paid = monthData?.record?.paid_amount ?? totalAmount;
          } else if (status === 'not_paid') {
            due = totalAmount;
          } else if (status === 'partial') {
            paid = monthData?.record?.paid_amount ?? 0;
            due = Math.max(0, totalAmount - paid);
          }

          bTotalPaid += paid;
          bTotalPending += due;
          bMonthlyCollected[mIdx] += paid;
          bMonthlyDue[mIdx] += due;
        }
      }

      overallTotalPaid += bTotalPaid;
      overallTotalPending += bTotalPending;
      for (let mIdx = 0; mIdx < 12; mIdx++) {
        overallMonthlyCollected[mIdx] += bMonthlyCollected[mIdx];
        overallMonthlyDue[mIdx] += bMonthlyDue[mIdx];
      }

      buildings.push({
        property: prop,
        report,
        totalPaid: bTotalPaid,
        totalPending: bTotalPending,
        monthlyCollected: bMonthlyCollected,
        monthlyDue: bMonthlyDue,
      });
    }

    return {
      year,
      buildings,
      totalTenants: overallTotalTenants,
      totalUnits: overallTotalUnits,
      totalPaid: overallTotalPaid,
      totalPending: overallTotalPending,
      monthlyCollected: overallMonthlyCollected,
      monthlyDue: overallMonthlyDue,
    };
  } catch (err) {
    console.error('[SQLite] getAllBuildingsRentReport error:', err);
    return {
      year,
      buildings: [],
      totalTenants: 0,
      totalUnits: 0,
      totalPaid: 0,
      totalPending: 0,
      monthlyCollected: new Array(12).fill(0),
      monthlyDue: new Array(12).fill(0),
    };
  }
}


