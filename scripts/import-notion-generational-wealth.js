// Ručni/jednokratni uvoz sadržaja Notion stranice "Generacijsko bogatstvo" u
// tab istog imena u ovoj aplikaciji. Podaci su u db/generational-wealth-seed-data.js
// (isti podaci koje server.js automatski učita ako je baza prazna - vidi
// tamo). Ova skripta postoji za slučaj kad server MORDORA već ima drugi
// sadržaj u tom tabu pa se auto-sjeme u server.js ne aktivira, a ipak želiš
// naknadno ubaciti (spojiti) ove retke.
//
// Sigurno je pokrenuti više puta: retci koji već postoje (ista kategorija +
// datum + sadržaj) se ne dupliciraju.
//
// Pokretanje lokalno (SQLite, iz mape projekta):
//   node scripts/import-notion-generational-wealth.js
// Pokretanje protiv Postgresa (npr. na mordoru):
//   DATABASE_URL=postgres://... node scripts/import-notion-generational-wealth.js

import { GENERATIONAL_WEALTH_SEED } from '../db/generational-wealth-seed-data.js';

const usePostgres = !!process.env.DATABASE_URL;
const db = usePostgres ? await import('../db/postgres.js') : await import('../db/sqlite.js');

const uid = () => Math.random().toString(36).slice(2, 9);

async function run() {
  await db.init();
  const state = await db.getState();
  const existing = state.wealthItems || [];

  const key = (w) => `${w.category}|${w.itemDate || ''}|${w.content}`;
  const existingKeys = new Set(existing.map(key));

  const toAdd = GENERATIONAL_WEALTH_SEED.filter((r) => !existingKeys.has(key(r))).map((r) => ({ id: uid(), ...r }));
  const skipped = GENERATIONAL_WEALTH_SEED.length - toAdd.length;

  if (toAdd.length === 0) {
    console.log(`Nema ništa novo za uvoz (svih ${skipped} redaka već postoji u bazi).`);
    process.exit(0);
  }

  const newWealthItems = [...existing, ...toAdd];
  await db.saveState({ ...state, wealthItems: newWealthItems });

  console.log(`Uvezeno ${toAdd.length} novih stavki u "Generacijsko bogatstvo" (${skipped} preskočeno jer već postoje).`);
  process.exit(0);
}

run().catch((e) => {
  console.error('Uvoz nije uspio:', e);
  process.exit(1);
});
