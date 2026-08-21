// Jednokratna migracija: pročita sve iz lokalne SQLite baze i upiše u Postgres.
// Prije pokretanja postavi DATABASE_URL na tvoju Postgres bazu, npr:
//   export DATABASE_URL=postgres://kompic:change-me@localhost:5432/kompic
//   node scripts/migrate-to-postgres.js

import * as sqliteDb from '../db/sqlite.js';
import * as postgresDb from '../db/postgres.js';

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('Nedostaje DATABASE_URL. Postavi ga prije pokretanja skripte.');
    process.exit(1);
  }

  console.log('Čitam podatke iz lokalne SQLite baze (moj-kompic.db)...');
  await sqliteDb.init();
  const state = await sqliteDb.getState();
  console.log(`Pronađeno: ${state.categories.length} kategorija, ${state.snapshots.length} mjeseci.`);

  if (state.snapshots.length === 0) {
    console.log('Nema podataka za migraciju — provjeri da si u mapi projekta gdje se nalazi moj-kompic.db.');
  }

  console.log(`Upisujem u Postgres (${process.env.DATABASE_URL.replace(/:[^:@]*@/, ':****@')})...`);
  await postgresDb.init();
  await postgresDb.saveState(state);

  console.log('Migracija gotova. Provjeri podatke u aplikaciji prije nego obrišeš staru SQLite datoteku.');
  process.exit(0);
}

main().catch((e) => {
  console.error('Migracija nije uspjela:', e);
  process.exit(1);
});
