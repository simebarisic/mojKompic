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
    CREATE TABLE IF NOT EXISTS metal_items (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      label TEXT NOT NULL,
      weight_grams REAL NOT NULL,
      purity_permille REAL NOT NULL,
      quantity REAL NOT NULL,
      purchase_price REAL,
      purchase_date TEXT,
      notes TEXT,
      sort_order INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE TABLE IF NOT EXISTS investments (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      type TEXT NOT NULL,
      buy_date TEXT NOT NULL,
      buy_price REAL NOT NULL,
      quantity REAL NOT NULL,
      current_price REAL,
      sell_date TEXT,
      sell_price REAL,
      notes TEXT,
      sort_order INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS wealth_items (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      item_date TEXT,
      content TEXT NOT NULL,
      sort_order INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS fi_scenarios (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      current_age REAL NOT NULL,
      investing_years REAL NOT NULL,
      payout_years REAL NOT NULL,
      expected_return_pct REAL NOT NULL,
      current_capital REAL NOT NULL,
      monthly_contribution REAL NOT NULL,
      contribution_growth_pct REAL NOT NULL DEFAULT 0,
      fee_pct REAL NOT NULL DEFAULT 0,
      expected_pension REAL NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS holdings_history (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      month TEXT NOT NULL,
      location TEXT NOT NULL DEFAULT '',
      quantity REAL NOT NULL,
      UNIQUE (kind, month, location)
    );
  `);

  // Migracija za baze kreirane prije uvođenja "jedinice"/valute po kategoriji
  // i količine po mjesečnoj stavci - SQLite ne podržava "ADD COLUMN IF NOT
  // EXISTS", pa se provjerava PRAGMA table_info. NAPOMENA: "unit" i
  // "quantity" (na snapshot_values) su od rujna 2026. napušteni u korist
  // zasebnih stranica "Praćenje količine" (vidi holdings_history gore) -
  // stupci ostaju radi kompatibilnosti sa starim podacima, ali se više ne
  // pišu/čitaju iz frontenda.
  const categoryCols = database.prepare('PRAGMA table_info(categories)').all().map((c) => c.name);
  if (!categoryCols.includes('unit')) database.exec('ALTER TABLE categories ADD COLUMN unit TEXT');
  if (!categoryCols.includes('currency')) database.exec('ALTER TABLE categories ADD COLUMN currency TEXT');
  const snapshotValueCols = database.prepare('PRAGMA table_info(snapshot_values)').all().map((c) => c.name);
  if (!snapshotValueCols.includes('quantity')) database.exec('ALTER TABLE snapshot_values ADD COLUMN quantity REAL');

  // Migracija holdings_history na razdiobu po lokacijama (rujan 2026): stari
  // UNIQUE(kind, month) ne dopušta više unosa za isti mjesec, pa se tablica
  // mora u cijelosti presložiti (SQLite ne podržava mijenjanje UNIQUE
  // ograničenja preko ALTER TABLE). Postojeći unosi dobivaju praznu lokaciju
  // (tretiraju se kao jedan zbirni unos) i ostaju netaknuti.
  const holdingsCols = database.prepare('PRAGMA table_info(holdings_history)').all().map((c) => c.name);
  if (!holdingsCols.includes('location')) {
    database.exec(`
      ALTER TABLE holdings_history RENAME TO holdings_history_old;
      CREATE TABLE holdings_history (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        month TEXT NOT NULL,
        location TEXT NOT NULL DEFAULT '',
        quantity REAL NOT NULL,
        UNIQUE (kind, month, location)
      );
      INSERT INTO holdings_history (id, kind, month, location, quantity)
        SELECT id, kind, month, '', quantity FROM holdings_history_old;
      DROP TABLE holdings_history_old;
    `);
  }
}

export async function getState() {
  const database = getDb();
  const categories = database.prepare('SELECT id, label, grp AS "group", unit, currency FROM categories ORDER BY sort_order').all();
  const snapshotRows = database.prepare('SELECT id, month FROM snapshots').all();
  const valueRows = database.prepare('SELECT snapshot_id, category_id, amount, quantity FROM snapshot_values').all();
  const incomeRows = database.prepare('SELECT id, snapshot_id, label, amount FROM income_items').all();
  const expenseRows = database.prepare('SELECT id, snapshot_id, label, amount FROM expense_items').all();
  const consumptionAssets = database.prepare(`
    SELECT id, label, type, purchase_value AS "purchaseValue", purchase_date AS "purchaseDate",
           depreciation_rate AS "depreciationRate", value_override AS "valueOverride",
           override_date AS "overrideDate", notes
    FROM consumption_assets ORDER BY sort_order
  `).all();
  const metalItems = database.prepare(`
    SELECT id, type, label, weight_grams AS "weightGrams", purity_permille AS "purityPermille",
           quantity, purchase_price AS "purchasePrice", purchase_date AS "purchaseDate", notes
    FROM metal_items ORDER BY sort_order
  `).all();
  const settingsRows = database.prepare('SELECT key, value FROM app_settings').all();
  const settings = Object.fromEntries(settingsRows.map((r) => {
    try { return [r.key, JSON.parse(r.value)]; } catch { return [r.key, null]; }
  }));
  const investments = database.prepare(`
    SELECT id, label, type, buy_date AS "buyDate", buy_price AS "buyPrice", quantity,
           current_price AS "currentPrice", sell_date AS "sellDate", sell_price AS "sellPrice", notes
    FROM investments ORDER BY sort_order
  `).all();
  const wealthItems = database.prepare(`
    SELECT id, category, item_date AS "itemDate", content
    FROM wealth_items ORDER BY sort_order
  `).all();
  const fiScenarios = database.prepare(`
    SELECT id, name, current_age AS "currentAge", investing_years AS "investingYears",
           payout_years AS "payoutYears", expected_return_pct AS "expectedReturnPct",
           current_capital AS "currentCapital", monthly_contribution AS "monthlyContribution",
           contribution_growth_pct AS "contributionGrowthPct", fee_pct AS "feePct",
           expected_pension AS "expectedPension"
    FROM fi_scenarios ORDER BY sort_order
  `).all();

  const snapshots = snapshotRows.map((s) => ({
    id: s.id,
    month: s.month,
    values: Object.fromEntries(valueRows.filter((v) => v.snapshot_id === s.id).map((v) => [v.category_id, v.amount])),
    quantities: Object.fromEntries(valueRows.filter((v) => v.snapshot_id === s.id && v.quantity !== null && v.quantity !== undefined).map((v) => [v.category_id, v.quantity])),
    income: incomeRows.filter((r) => r.snapshot_id === s.id).map((r) => ({ id: r.id, label: r.label, amount: r.amount })),
    expenses: expenseRows.filter((r) => r.snapshot_id === s.id).map((r) => ({ id: r.id, label: r.label, amount: r.amount })),
  }));

  const holdingsHistory = database.prepare('SELECT id, kind, month, location, quantity FROM holdings_history ORDER BY kind, month, location').all();

  return { categories, snapshots, consumptionAssets, metalItems, settings, investments, wealthItems, fiScenarios, holdingsHistory };
}

export async function saveState({ categories = [], snapshots = [], consumptionAssets = [], metalItems = [], settings = {}, investments = [], wealthItems = [], fiScenarios = [], holdingsHistory = [] }) {
  const database = getDb();
  const writeAll = database.transaction(() => {
    database.exec('DELETE FROM categories; DELETE FROM snapshots; DELETE FROM snapshot_values; DELETE FROM income_items; DELETE FROM expense_items; DELETE FROM consumption_assets; DELETE FROM metal_items; DELETE FROM app_settings; DELETE FROM investments; DELETE FROM wealth_items; DELETE FROM fi_scenarios; DELETE FROM holdings_history;');

    const insCat = database.prepare('INSERT INTO categories (id, label, grp, sort_order, unit, currency) VALUES (?, ?, ?, ?, ?, ?)');
    categories.forEach((c, i) => insCat.run(c.id, c.label, c.group, i, c.unit || null, c.currency || null));

    const insSnap = database.prepare('INSERT INTO snapshots (id, month) VALUES (?, ?)');
    const insVal = database.prepare('INSERT INTO snapshot_values (snapshot_id, category_id, amount, quantity) VALUES (?, ?, ?, ?)');
    const insInc = database.prepare('INSERT INTO income_items (id, snapshot_id, label, amount) VALUES (?, ?, ?, ?)');
    const insExp = database.prepare('INSERT INTO expense_items (id, snapshot_id, label, amount) VALUES (?, ?, ?, ?)');

    snapshots.forEach((s) => {
      insSnap.run(s.id, s.month);
      const valueEntries = s.values || {};
      const qtyEntries = s.quantities || {};
      const catIds = new Set([...Object.keys(valueEntries), ...Object.keys(qtyEntries)]);
      catIds.forEach((catId) => {
        const rawAmount = valueEntries[catId];
        const rawQty = qtyEntries[catId];
        const hasAmount = !(rawAmount === '' || rawAmount === null || rawAmount === undefined);
        const hasQty = !(rawQty === '' || rawQty === null || rawQty === undefined);
        if (!hasAmount && !hasQty) return;
        const n = hasAmount ? Number(rawAmount) : 0;
        if (Number.isNaN(n)) return;
        const q = hasQty ? Number(rawQty) : null;
        insVal.run(s.id, catId, n, Number.isNaN(q) ? null : q);
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

    const insMetal = database.prepare(`
      INSERT INTO metal_items
        (id, type, label, weight_grams, purity_permille, quantity, purchase_price, purchase_date, notes, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    metalItems.forEach((m, i) => insMetal.run(
      m.id, m.type, m.label, Number(m.weightGrams) || 0, Number(m.purityPermille) || 0, Number(m.quantity) || 0,
      m.purchasePrice === '' || m.purchasePrice === null || m.purchasePrice === undefined ? null : Number(m.purchasePrice),
      m.purchaseDate || null, m.notes || '', i
    ));

    const insSetting = database.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?)');
    Object.entries(settings || {}).forEach(([key, value]) => insSetting.run(key, JSON.stringify(value ?? null)));

    const insInvestment = database.prepare(`
      INSERT INTO investments
        (id, label, type, buy_date, buy_price, quantity, current_price, sell_date, sell_price, notes, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    investments.forEach((inv, i) => insInvestment.run(
      inv.id, inv.label, inv.type, inv.buyDate, Number(inv.buyPrice) || 0, Number(inv.quantity) || 0,
      inv.currentPrice === '' || inv.currentPrice === null || inv.currentPrice === undefined ? null : Number(inv.currentPrice),
      inv.sellDate || null,
      inv.sellPrice === '' || inv.sellPrice === null || inv.sellPrice === undefined ? null : Number(inv.sellPrice),
      inv.notes || '', i
    ));

    const insWealth = database.prepare(`
      INSERT INTO wealth_items (id, category, item_date, content, sort_order)
      VALUES (?, ?, ?, ?, ?)
    `);
    wealthItems.forEach((w, i) => insWealth.run(
      w.id, w.category, w.itemDate || null, w.content || '', i
    ));

    const insFi = database.prepare(`
      INSERT INTO fi_scenarios
        (id, name, current_age, investing_years, payout_years, expected_return_pct,
         current_capital, monthly_contribution, contribution_growth_pct, fee_pct, expected_pension, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    fiScenarios.forEach((f, i) => insFi.run(
      f.id, f.name || 'Scenarij', Number(f.currentAge) || 0, Number(f.investingYears) || 0, Number(f.payoutYears) || 0,
      Number(f.expectedReturnPct) || 0, Number(f.currentCapital) || 0, Number(f.monthlyContribution) || 0,
      Number(f.contributionGrowthPct) || 0, Number(f.feePct) || 0, Number(f.expectedPension) || 0, i
    ));

    const insHolding = database.prepare('INSERT INTO holdings_history (id, kind, month, location, quantity) VALUES (?, ?, ?, ?, ?)');
    holdingsHistory.forEach((h) => insHolding.run(h.id, h.kind, h.month, h.location || '', Number(h.quantity) || 0));
  });

  writeAll();
}
