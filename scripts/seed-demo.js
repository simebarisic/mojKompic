// Puni bazu (Postgres ili SQLite - ovisi o DATABASE_URL, isto kao server.js)
// izmišljenim, ali realističnim podacima za demo. NE dira produkcijsku bazu
// osim ako slučajno pokreneš ovo s istim DATABASE_URL/SQLITE_PATH kao produkcija
// - zato se ova skripta u pravilu pokreće samo unutar docker-compose.demo.yml
// (odvojen kontejner, odvojena baza).
//
// Pokretanje lokalno (SQLite):
//   SQLITE_PATH=./moj-kompic-demo.db node scripts/seed-demo.js
// Pokretanje protiv Postgresa (npr. iz docker-compose.demo.yml):
//   DATABASE_URL=postgres://... node scripts/seed-demo.js

const usePostgres = !!process.env.DATABASE_URL;
const db = usePostgres ? await import('../db/postgres.js') : await import('../db/sqlite.js');

const uid = () => Math.random().toString(36).slice(2, 9);

const categories = [
  { id: 'tekuci', label: 'Tekući (OTP)', group: 'liquid' },
  { id: 'revolut', label: 'Revolut (dionice)', group: 'liquid' },
  { id: 'trading212', label: 'Trading212 (dionice)', group: 'liquid' },
  { id: 'btc', label: 'BTC', group: 'liquid' },
  { id: 'zlato', label: 'Zlato', group: 'liquid' },
  { id: 'srebro', label: 'Srebro', group: 'liquid' },
  { id: 'mmdp', label: 'MMDP', group: 'liquid' },
  { id: 'strc', label: 'STRC', group: 'liquid' },
  { id: 'mirovinski2', label: '2. mirovinski stup', group: 'offbalance' },
  { id: 'treciStup', label: '3. stup', group: 'pension' },
  { id: 'pepp', label: 'PEPP', group: 'pension' },
  { id: 'kredit', label: 'Kredit (stambeni)', group: 'liability' },
  { id: 'kreditnaKartica', label: 'Kreditna kartica', group: 'liability' },
  { id: 'poljica', label: 'Poljica (zemljište)', group: 'realestate' },
];

// 10 mjeseci unatrag, s blagim rastom + malo šuma da izgleda realno.
const MONTHS_BACK = 10;
const now = new Date();
const monthStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

const rnd = (min, max) => Math.round(min + Math.random() * (max - min));
const jitter = (base, pct = 0.06) => Math.round(base * (1 + (Math.random() * 2 - 1) * pct));

const snapshots = [];
for (let i = MONTHS_BACK - 1; i >= 0; i--) {
  const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
  const progress = (MONTHS_BACK - 1 - i) / (MONTHS_BACK - 1); // 0 -> 1 kroz vrijeme

  snapshots.push({
    id: uid(),
    month: monthStr(d),
    values: {
      tekuci: jitter(2500 + progress * 800),
      revolut: jitter(4200 + progress * 3800),
      trading212: jitter(3100 + progress * 2600),
      btc: jitter(6800 + progress * 9500, 0.12),
      zlato: jitter(1500 + progress * 600),
      srebro: jitter(400 + progress * 150),
      mmdp: jitter(3000 + progress * 500),
      strc: jitter(1800 + progress * 2200),
      mirovinski2: jitter(9500 + progress * 2200),
      treciStup: jitter(2200 + progress * 1800),
      pepp: jitter(1100 + progress * 900),
      kredit: Math.max(0, Math.round(72000 - progress * 6000)),
      kreditnaKartica: rnd(0, 350),
      poljica: 45000,
    },
    income: [
      { id: uid(), label: 'Plaća', amount: jitter(2100 + progress * 300, 0.03) },
      ...(Math.random() > 0.6 ? [{ id: uid(), label: 'Freelance', amount: rnd(150, 600) }] : []),
    ],
    expenses: [
      { id: uid(), label: 'Stanovanje', amount: jitter(650, 0.04) },
      { id: uid(), label: 'Namirnice', amount: jitter(420, 0.1) },
      { id: uid(), label: 'Prijevoz', amount: rnd(60, 140) },
      { id: uid(), label: 'Izlasci', amount: rnd(80, 220) },
    ],
  });
}

const consumptionAssets = [
  {
    id: uid(), label: 'Škoda Octavia 2020', type: 'auto',
    purchaseValue: 18500, purchaseDate: '2021-03', depreciationRate: 15,
    valueOverride: null, overrideDate: null, notes: 'Redovni servis kod ovlaštenog servisera.',
  },
  {
    id: uid(), label: 'MacBook Pro 14"', type: 'elektronika',
    purchaseValue: 2400, purchaseDate: '2023-09', depreciationRate: 25,
    valueOverride: null, overrideDate: null, notes: '',
  },
  {
    id: uid(), label: 'Stan (gdje živim)', type: 'nekretnina',
    purchaseValue: 165000, purchaseDate: '2019-06', depreciationRate: 0,
    valueOverride: 185000, overrideDate: monthStr(new Date(now.getFullYear(), now.getMonth() - 2, 1)),
    notes: 'Procjena po zadnjoj sličnoj prodaji u zgradi.',
  },
];

await db.init();
await db.saveState({ categories, snapshots, consumptionAssets });

console.log(`Demo baza napunjena (${usePostgres ? 'Postgres' : 'SQLite'}): ${categories.length} kategorija, ${snapshots.length} mjeseci, ${consumptionAssets.length} stavke potrošne imovine.`);
process.exit(0);
