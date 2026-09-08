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
    ALTER TABLE snapshot_values ADD COLUMN IF NOT EXISTS quantity DOUBLE PRECISION;
    ALTER TABLE categories ADD COLUMN IF NOT EXISTS unit TEXT;
    ALTER TABLE categories ADD COLUMN IF NOT EXISTS currency TEXT;
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
    CREATE TABLE IF NOT EXISTS metal_items (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      label TEXT NOT NULL,
      weight_grams DOUBLE PRECISION NOT NULL,
      purity_permille DOUBLE PRECISION NOT NULL,
      quantity DOUBLE PRECISION NOT NULL,
      purchase_price DOUBLE PRECISION,
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
      buy_price DOUBLE PRECISION NOT NULL,
      quantity DOUBLE PRECISION NOT NULL,
      current_price DOUBLE PRECISION,
      sell_date TEXT,
      sell_price DOUBLE PRECISION,
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
      current_age DOUBLE PRECISION NOT NULL,
      investing_years DOUBLE PRECISION NOT NULL,
      payout_years DOUBLE PRECISION NOT NULL,
      expected_return_pct DOUBLE PRECISION NOT NULL,
      current_capital DOUBLE PRECISION NOT NULL,
      monthly_contribution DOUBLE PRECISION NOT NULL,
      contribution_growth_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
      fee_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
      expected_pension DOUBLE PRECISION NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS holdings_history (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      month TEXT NOT NULL,
      location TEXT NOT NULL DEFAULT '',
      quantity DOUBLE PRECISION NOT NULL,
      UNIQUE (kind, month, location)
    );
  `);

  // Migracija holdings_history na razdiobu po lokacijama (rujan 2026):
  // dodaje stupac "location" ako ne postoji i zamjenjuje stari
  // UNIQUE(kind, month) ograničenje sa UNIQUE(kind, month, location), tako
  // da isti mjesec može imati više unosa (npr. po novčaniku/mjenjačnici).
  // Postojeći unosi zadržavaju praznu lokaciju (jedan zbirni unos).
  await p.query(`ALTER TABLE holdings_history ADD COLUMN IF NOT EXISTS location TEXT NOT NULL DEFAULT ''`);
  await p.query(`ALTER TABLE holdings_history DROP CONSTRAINT IF EXISTS holdings_history_kind_month_key`);
  const { rows: holdingsConstraintRows } = await p.query(
    `SELECT 1 FROM pg_constraint WHERE conname = 'holdings_history_kind_month_location_key'`
  );
  if (holdingsConstraintRows.length === 0) {
    await p.query(
      `ALTER TABLE holdings_history ADD CONSTRAINT holdings_history_kind_month_location_key UNIQUE (kind, month, location)`
    );
  }
}

export async function getState() {
  const p = getPool();
  const { rows: categories } = await p.query('SELECT id, label, grp AS "group", unit, currency FROM categories ORDER BY sort_order');
  const { rows: snapshotRows } = await p.query('SELECT id, month FROM snapshots');
  const { rows: valueRows } = await p.query('SELECT snapshot_id, category_id, amount, quantity FROM snapshot_values');
  const { rows: incomeRows } = await p.query('SELECT id, snapshot_id, label, amount FROM income_items');
  const { rows: expenseRows } = await p.query('SELECT id, snapshot_id, label, amount FROM expense_items');
  const { rows: consumptionRows } = await p.query(`
    SELECT id, label, type, purchase_value AS "purchaseValue", purchase_date AS "purchaseDate",
           depreciation_rate AS "depreciationRate", value_override AS "valueOverride",
           override_date AS "overrideDate", notes
    FROM consumption_assets ORDER BY sort_order
  `);
  const { rows: metalRows } = await p.query(`
    SELECT id, type, label, weight_grams AS "weightGrams", purity_permille AS "purityPermille",
           quantity, purchase_price AS "purchasePrice", purchase_date AS "purchaseDate", notes
    FROM metal_items ORDER BY sort_order
  `);
  const { rows: settingsRows } = await p.query('SELECT key, value FROM app_settings');
  const { rows: investmentRows } = await p.query(`
    SELECT id, label, type, buy_date AS "buyDate", buy_price AS "buyPrice", quantity,
           current_price AS "currentPrice", sell_date AS "sellDate", sell_price AS "sellPrice", notes
    FROM investments ORDER BY sort_order
  `);
  const { rows: wealthRows } = await p.query(`
    SELECT id, category, item_date AS "itemDate", content
    FROM wealth_items ORDER BY sort_order
  `);
  const { rows: holdingsRows } = await p.query('SELECT id, kind, month, location, quantity FROM holdings_history ORDER BY kind, month, location');
  const { rows: fiRows } = await p.query(`
    SELECT id, name, current_age AS "currentAge", investing_years AS "investingYears",
           payout_years AS "payoutYears", expected_return_pct AS "expectedReturnPct",
           current_capital AS "currentCapital", monthly_contribution AS "monthlyContribution",
           contribution_growth_pct AS "contributionGrowthPct", fee_pct AS "feePct",
           expected_pension AS "expectedPension"
    FROM fi_scenarios ORDER BY sort_order
  `);

  const snapshots = snapshotRows.map((s) => ({
    id: s.id,
    month: s.month,
    values: Object.fromEntries(valueRows.filter((v) => v.snapshot_id === s.id).map((v) => [v.category_id, Number(v.amount)])),
    quantities: Object.fromEntries(valueRows.filter((v) => v.snapshot_id === s.id && v.quantity !== null && v.quantity !== undefined).map((v) => [v.category_id, Number(v.quantity)])),
    income: incomeRows.filter((r) => r.snapshot_id === s.id).map((r) => ({ id: r.id, label: r.label, amount: Number(r.amount) })),
    expenses: expenseRows.filter((r) => r.snapshot_id === s.id).map((r) => ({ id: r.id, label: r.label, amount: Number(r.amount) })),
  }));

  const consumptionAssets = consumptionRows.map((a) => ({
    ...a,
    purchaseValue: Number(a.purchaseValue),
    depreciationRate: Number(a.depreciationRate),
    valueOverride: a.valueOverride === null ? null : Number(a.valueOverride),
  }));

  const metalItems = metalRows.map((m) => ({
    ...m,
    weightGrams: Number(m.weightGrams),
    purityPermille: Number(m.purityPermille),
    quantity: Number(m.quantity),
    purchasePrice: m.purchasePrice === null ? null : Number(m.purchasePrice),
  }));

  const settings = Object.fromEntries(settingsRows.map((r) => {
    try { return [r.key, JSON.parse(r.value)]; } catch { return [r.key, null]; }
  }));

  const investments = investmentRows.map((inv) => ({
    ...inv,
    buyPrice: Number(inv.buyPrice),
    quantity: Number(inv.quantity),
    currentPrice: inv.currentPrice === null ? null : Number(inv.currentPrice),
    sellPrice: inv.sellPrice === null ? null : Number(inv.sellPrice),
  }));

  const wealthItems = wealthRows;

  const fiScenarios = fiRows.map((f) => ({
    ...f,
    currentAge: Number(f.currentAge),
    investingYears: Number(f.investingYears),
    payoutYears: Number(f.payoutYears),
    expectedReturnPct: Number(f.expectedReturnPct),
    currentCapital: Number(f.currentCapital),
    monthlyContribution: Number(f.monthlyContribution),
    contributionGrowthPct: Number(f.contributionGrowthPct),
    feePct: Number(f.feePct),
    expectedPension: Number(f.expectedPension),
  }));

  const holdingsHistory = holdingsRows.map((h) => ({ ...h, quantity: Number(h.quantity) }));

  return { categories, snapshots, consumptionAssets, metalItems, settings, investments, wealthItems, fiScenarios, holdingsHistory };
}

export async function saveState({ categories = [], snapshots = [], consumptionAssets = [], metalItems = [], settings = {}, investments = [], wealthItems = [], fiScenarios = [], holdingsHistory = [] }) {
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
    await client.query('DELETE FROM metal_items');
    await client.query('DELETE FROM app_settings');
    await client.query('DELETE FROM investments');
    await client.query('DELETE FROM wealth_items');
    await client.query('DELETE FROM fi_scenarios');
    await client.query('DELETE FROM holdings_history');

    for (let i = 0; i < categories.length; i++) {
      const c = categories[i];
      await client.query('INSERT INTO categories (id, label, grp, sort_order, unit, currency) VALUES ($1,$2,$3,$4,$5,$6)', [c.id, c.label, c.group, i, c.unit || null, c.currency || null]);
    }
    for (const s of snapshots) {
      await client.query('INSERT INTO snapshots (id, month) VALUES ($1,$2)', [s.id, s.month]);
      const valueEntries = s.values || {};
      const qtyEntries = s.quantities || {};
      const catIds = new Set([...Object.keys(valueEntries), ...Object.keys(qtyEntries)]);
      for (const catId of catIds) {
        const rawAmount = valueEntries[catId];
        const rawQty = qtyEntries[catId];
        const hasAmount = !(rawAmount === '' || rawAmount === null || rawAmount === undefined);
        const hasQty = !(rawQty === '' || rawQty === null || rawQty === undefined);
        if (!hasAmount && !hasQty) continue;
        const n = hasAmount ? Number(rawAmount) : 0;
        if (Number.isNaN(n)) continue;
        const q = hasQty ? Number(rawQty) : null;
        await client.query('INSERT INTO snapshot_values (snapshot_id, category_id, amount, quantity) VALUES ($1,$2,$3,$4)', [s.id, catId, n, Number.isNaN(q) ? null : q]);
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
    for (let i = 0; i < metalItems.length; i++) {
      const m = metalItems[i];
      await client.query(
        `INSERT INTO metal_items
          (id, type, label, weight_grams, purity_permille, quantity, purchase_price, purchase_date, notes, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          m.id, m.type, m.label, Number(m.weightGrams) || 0, Number(m.purityPermille) || 0, Number(m.quantity) || 0,
          m.purchasePrice === '' || m.purchasePrice === null || m.purchasePrice === undefined ? null : Number(m.purchasePrice),
          m.purchaseDate || null, m.notes || '', i,
        ]
      );
    }
    for (const [key, value] of Object.entries(settings || {})) {
      await client.query('INSERT INTO app_settings (key, value) VALUES ($1,$2)', [key, JSON.stringify(value ?? null)]);
    }
    for (let i = 0; i < investments.length; i++) {
      const inv = investments[i];
      await client.query(
        `INSERT INTO investments
          (id, label, type, buy_date, buy_price, quantity, current_price, sell_date, sell_price, notes, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          inv.id, inv.label, inv.type, inv.buyDate, Number(inv.buyPrice) || 0, Number(inv.quantity) || 0,
          inv.currentPrice === '' || inv.currentPrice === null || inv.currentPrice === undefined ? null : Number(inv.currentPrice),
          inv.sellDate || null,
          inv.sellPrice === '' || inv.sellPrice === null || inv.sellPrice === undefined ? null : Number(inv.sellPrice),
          inv.notes || '', i,
        ]
      );
    }
    for (let i = 0; i < wealthItems.length; i++) {
      const w = wealthItems[i];
      await client.query(
        'INSERT INTO wealth_items (id, category, item_date, content, sort_order) VALUES ($1,$2,$3,$4,$5)',
        [w.id, w.category, w.itemDate || null, w.content || '', i]
      );
    }
    for (let i = 0; i < fiScenarios.length; i++) {
      const f = fiScenarios[i];
      await client.query(
        `INSERT INTO fi_scenarios
          (id, name, current_age, investing_years, payout_years, expected_return_pct,
           current_capital, monthly_contribution, contribution_growth_pct, fee_pct, expected_pension, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          f.id, f.name || 'Scenarij', Number(f.currentAge) || 0, Number(f.investingYears) || 0, Number(f.payoutYears) || 0,
          Number(f.expectedReturnPct) || 0, Number(f.currentCapital) || 0, Number(f.monthlyContribution) || 0,
          Number(f.contributionGrowthPct) || 0, Number(f.feePct) || 0, Number(f.expectedPension) || 0, i,
        ]
      );
    }
    for (const h of holdingsHistory) {
      await client.query(
        'INSERT INTO holdings_history (id, kind, month, location, quantity) VALUES ($1,$2,$3,$4,$5)',
        [h.id, h.kind, h.month, h.location || '', Number(h.quantity) || 0]
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
