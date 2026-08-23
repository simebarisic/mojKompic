import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let db;
function getDb() {
  if (!db) {
    db = new Database(process.env.SQLITE_PATH || path.join(__dirname, '..', 'moj-kompic.db'));
    db.pragma('journal_mode = WAL');
  }
  return db;
}

export async function init() {
  const database = getDb();
  database.exec(`
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
      amount REAL NOT NULL,
      PRIMARY KEY (snapshot_id, category_id)
    );
    CREATE TABLE IF NOT EXISTS income_items (
      id TEXT PRIMARY KEY,
      snapshot_id TEXT NOT NULL,
      label TEXT,
      amount REAL
    );
    CREATE TABLE IF NOT EXISTS expense_items (
      id TEXT PRIMARY KEY,
      snapshot_id TEXT NOT NULL,
      label TEXT,
      amount REAL
    );
    CREATE TABLE IF NOT EXISTS consumption_assets (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      type TEXT NOT NULL,
      purchase_value REAL NOT NULL,
      purchase_date TEXT NOT NULL,
      depreciation_rate REAL NOT NULL,
      value_override REAL,
      override_date TEXT,
      notes TEXT,
      sort_order INTEGER NOT NULL
    );
  `);
}

export async function getState() {
  const database = getDb();
  const categories = database.prepare('SELECT id, label, grp AS "group" FROM categories ORDER BY sort_order').all();
  const snapshotRows = database.prepare('SELECT id, month FROM snapshots').all();
  const valueRows = database.prepare('SELECT snapshot_id, category_id, amount FROM snapshot_values').all();
  const incomeRows = database.prepare('SELECT id, snapshot_id, label, amount FROM income_items').all();
  const expenseRows = database.prepare('SELECT id, snapshot_id, label, amount FROM expense_items').all();
  const consumptionAssets = database.prepare(`
    SELECT id, label, type, purchase_value AS "purchaseValue", purchase_date AS "purchaseDate",
           depreciation_rate AS "depreciationRate", value_override AS "valueOverride",
           override_date AS "overrideDate", notes
    FROM consumption_assets ORDER BY sort_order
  `).all();

  const snapshots = snapshotRows.map((s) => ({
    id: s.id,
    month: s.month,
    values: Object.fromEntries(valueRows.filter((v) => v.snapshot_id === s.id).map((v) => [v.category_id, v.amount])),
    income: incomeRows.filter((r) => r.snapshot_id === s.id).map((r) => ({ id: r.id, label: r.label, amount: r.amount })),
    expenses: expenseRows.filter((r) => r.snapshot_id === s.id).map((r) => ({ id: r.id, label: r.label, amount: r.amount })),
  }));

  return { categories, snapshots, consumptionAssets };
}

export async function saveState({ categories = [], snapshots = [], consumptionAssets = [] }) {
  const database = getDb();
  const writeAll = database.transaction(() => {
    database.exec('DELETE FROM categories; DELETE FROM snapshots; DELETE FROM snapshot_values; DELETE FROM income_items; DELETE FROM expense_items; DELETE FROM consumption_assets;');

    const insCat = database.prepare('INSERT INTO categories (id, label, grp, sort_order) VALUES (?, ?, ?, ?)');
    categories.forEach((c, i) => insCat.run(c.id, c.label, c.group, i));

    const insSnap = database.prepare('INSERT INTO snapshots (id, month) VALUES (?, ?)');
    const insVal = database.prepare('INSERT INTO snapshot_values (snapshot_id, category_id, amount) VALUES (?, ?, ?)');
    const insInc = database.prepare('INSERT INTO income_items (id, snapshot_id, label, amount) VALUES (?, ?, ?, ?)');
    const insExp = database.prepare('INSERT INTO expense_items (id, snapshot_id, label, amount) VALUES (?, ?, ?, ?)');

    snapshots.forEach((s) => {
      insSnap.run(s.id, s.month);
      Object.entries(s.values || {}).forEach(([catId, amount]) => {
        if (amount === '' || amount === null || amount === undefined) return;
        const n = Number(amount);
        if (Number.isNaN(n)) return;
        insVal.run(s.id, catId, n);
      });
      (s.income || []).forEach((r) => insInc.run(r.id, s.id, r.label || '', Number(r.amount) || 0));
      (s.expenses || []).forEach((r) => insExp.run(r.id, s.id, r.label || '', Number(r.amount) || 0));
    });

    const insAsset = database.prepare(`
      INSERT INTO consumption_assets
        (id, label, type, purchase_value, purchase_date, depreciation_rate, value_override, override_date, notes, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    consumptionAssets.forEach((a, i) => insAsset.run(
      a.id, a.label, a.type, Number(a.purchaseValue) || 0, a.purchaseDate,
      Number(a.depreciationRate) || 0,
      a.valueOverride === '' || a.valueOverride === null || a.valueOverride === undefined ? null : Number(a.valueOverride),
      a.overrideDate || null, a.notes || '', i
    ));
  });

  writeAll();
}
