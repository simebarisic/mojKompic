import pg from 'pg';

const { Pool } = pg;

let pool;
function getPool() {
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return pool;
}

export async function init() {
  const p = getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      grp TEXT NOT NULL,
      sort_order INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS snapshots (
      id TEXT PRIMARY KEY,
      month TEXT NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS snapshot_values (
      snapshot_id TEXT NOT NULL,
      category_id TEXT NOT NULL,
      amount DOUBLE PRECISION NOT NULL,
      PRIMARY KEY (snapshot_id, category_id)
    );
    CREATE TABLE IF NOT EXISTS income_items (
      id TEXT PRIMARY KEY,
      snapshot_id TEXT NOT NULL,
      label TEXT,
      amount DOUBLE PRECISION
    );
    CREATE TABLE IF NOT EXISTS expense_items (
      id TEXT PRIMARY KEY,
      snapshot_id TEXT NOT NULL,
      label TEXT,
      amount DOUBLE PRECISION
    );
    CREATE TABLE IF NOT EXISTS consumption_assets (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      type TEXT NOT NULL,
      purchase_value DOUBLE PRECISION NOT NULL,
      purchase_date TEXT NOT NULL,
      depreciation_rate DOUBLE PRECISION NOT NULL,
      value_override DOUBLE PRECISION,
      override_date TEXT,
      notes TEXT,
      sort_order INTEGER NOT NULL
    );
  `);
}

export async function getState() {
  const p = getPool();
  const { rows: categories } = await p.query('SELECT id, label, grp AS "group" FROM categories ORDER BY sort_order');
  const { rows: snapshotRows } = await p.query('SELECT id, month FROM snapshots');
  const { rows: valueRows } = await p.query('SELECT snapshot_id, category_id, amount FROM snapshot_values');
  const { rows: incomeRows } = await p.query('SELECT id, snapshot_id, label, amount FROM income_items');
  const { rows: expenseRows } = await p.query('SELECT id, snapshot_id, label, amount FROM expense_items');
  const { rows: consumptionRows } = await p.query(`
    SELECT id, label, type, purchase_value AS "purchaseValue", purchase_date AS "purchaseDate",
           depreciation_rate AS "depreciationRate", value_override AS "valueOverride",
           override_date AS "overrideDate", notes
    FROM consumption_assets ORDER BY sort_order
  `);

  const snapshots = snapshotRows.map((s) => ({
    id: s.id,
    month: s.month,
    values: Object.fromEntries(valueRows.filter((v) => v.snapshot_id === s.id).map((v) => [v.category_id, Number(v.amount)])),
    income: incomeRows.filter((r) => r.snapshot_id === s.id).map((r) => ({ id: r.id, label: r.label, amount: Number(r.amount) })),
    expenses: expenseRows.filter((r) => r.snapshot_id === s.id).map((r) => ({ id: r.id, label: r.label, amount: Number(r.amount) })),
  }));

  const consumptionAssets = consumptionRows.map((a) => ({
    ...a,
    purchaseValue: Number(a.purchaseValue),
    depreciationRate: Number(a.depreciationRate),
    valueOverride: a.valueOverride === null ? null : Number(a.valueOverride),
  }));

  return { categories, snapshots, consumptionAssets };
}

export async function saveState({ categories = [], snapshots = [], consumptionAssets = [] }) {
  const p = getPool();
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM snapshot_values');
    await client.query('DELETE FROM income_items');
    await client.query('DELETE FROM expense_items');
    await client.query('DELETE FROM snapshots');
    await client.query('DELETE FROM categories');
    await client.query('DELETE FROM consumption_assets');

    for (let i = 0; i < categories.length; i++) {
      const c = categories[i];
      await client.query('INSERT INTO categories (id, label, grp, sort_order) VALUES ($1,$2,$3,$4)', [c.id, c.label, c.group, i]);
    }
    for (const s of snapshots) {
      await client.query('INSERT INTO snapshots (id, month) VALUES ($1,$2)', [s.id, s.month]);
      for (const [catId, amount] of Object.entries(s.values || {})) {
        if (amount === '' || amount === null || amount === undefined) continue;
        const n = Number(amount);
        if (Number.isNaN(n)) continue;
        await client.query('INSERT INTO snapshot_values (snapshot_id, category_id, amount) VALUES ($1,$2,$3)', [s.id, catId, n]);
      }
      for (const r of s.income || []) {
        await client.query('INSERT INTO income_items (id, snapshot_id, label, amount) VALUES ($1,$2,$3,$4)', [r.id, s.id, r.label || '', Number(r.amount) || 0]);
      }
      for (const r of s.expenses || []) {
        await client.query('INSERT INTO expense_items (id, snapshot_id, label, amount) VALUES ($1,$2,$3,$4)', [r.id, s.id, r.label || '', Number(r.amount) || 0]);
      }
    }
    for (let i = 0; i < consumptionAssets.length; i++) {
      const a = consumptionAssets[i];
      await client.query(
        `INSERT INTO consumption_assets
          (id, label, type, purchase_value, purchase_date, depreciation_rate, value_override, override_date, notes, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          a.id, a.label, a.type, Number(a.purchaseValue) || 0, a.purchaseDate,
          Number(a.depreciationRate) || 0,
          a.valueOverride === '' || a.valueOverride === null || a.valueOverride === undefined ? null : Number(a.valueOverride),
          a.overrideDate || null, a.notes || '', i,
        ]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
