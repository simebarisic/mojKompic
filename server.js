import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Bira bazu: ako je postavljen DATABASE_URL (Docker/Postgres), koristi Postgres.
// Inače (lokalni dev na Macu), koristi lokalnu SQLite datoteku.
const usePostgres = !!process.env.DATABASE_URL;
const db = usePostgres ? await import('./db/postgres.js') : await import('./db/sqlite.js');

await db.init();

const app = express();
app.use(express.json({ limit: '5mb' }));

// ---- Cijene zlata/srebra (za tab "Plemeniti metali") ----
// Dohvaća spot cijenu s api.gold-api.com (USD/trojskoj unci, bez API ključa)
// i tečaj USD->EUR s api.frankfurter.dev (ECB, bez API ključa), pa pretvara
// u EUR po gramu. Rezultat se kešira u memoriji da se izvori ne zovu na
// svaki render/refresh (i da app preživi kratkotrajne ispade tih servisa).
const GRAMS_PER_TROY_OUNCE = 31.1034768;
const METAL_PRICE_CACHE_MS = 10 * 60 * 1000; // 10 min
let metalPriceCache = { data: null, fetchedAt: 0 };

async function fetchMetalPrices() {
  const [xauRes, xagRes, fxRes] = await Promise.all([
    fetch('https://api.gold-api.com/price/XAU'),
    fetch('https://api.gold-api.com/price/XAG'),
    fetch('https://api.frankfurter.dev/v1/latest?from=USD&to=EUR'),
  ]);
  if (!xauRes.ok || !xagRes.ok) throw new Error('Izvor cijene metala nije dostupan.');
  if (!fxRes.ok) throw new Error('Izvor tečaja nije dostupan.');
  const [xau, xag, fx] = await Promise.all([xauRes.json(), xagRes.json(), fxRes.json()]);
  const usdToEur = fx?.rates?.EUR;
  if (!xau?.price || !xag?.price || !usdToEur) throw new Error('Nepotpun odgovor izvora cijena.');

  const toEurPerGram = (usdPerOz) => (usdPerOz / GRAMS_PER_TROY_OUNCE) * usdToEur;

  return {
    gold: { eurPerGram: toEurPerGram(xau.price), usdPerOz: xau.price, updatedAt: xau.updatedAt || null },
    silver: { eurPerGram: toEurPerGram(xag.price), usdPerOz: xag.price, updatedAt: xag.updatedAt || null },
    fx: { usdToEur, date: fx.date || null },
    fetchedAt: new Date().toISOString(),
  };
}

app.get('/api/metal-prices', async (req, res) => {
  const now = Date.now();
  if (metalPriceCache.data && now - metalPriceCache.fetchedAt < METAL_PRICE_CACHE_MS) {
    return res.json({ ...metalPriceCache.data, cached: true, stale: false });
  }
  try {
    const data = await fetchMetalPrices();
    metalPriceCache = { data, fetchedAt: now };
    res.json({ ...data, cached: false, stale: false });
  } catch (e) {
    console.error('Dohvat cijene zlata/srebra nije uspio:', e.message);
    if (metalPriceCache.data) {
      // Vrati zadnju poznatu cijenu (bolje stara nego nikakva), ali označi da je "stale".
      return res.json({ ...metalPriceCache.data, cached: true, stale: true });
    }
    res.status(502).json({ error: 'Ne mogu dohvatiti trenutnu cijenu zlata/srebra. Unesi cijenu ručno.' });
  }
});

app.get('/api/state', async (req, res) => {
  try {
    res.json(await db.getState());
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Čitanje iz baze nije uspjelo.' });
  }
});

app.post('/api/state', async (req, res) => {
  try {
    const incoming = req.body || {};
    // Zaštitna mjera: odbij "spremanje" koje bi obrisalo postojeće mjesece
    // ako dolazni podaci nemaju nijedan snapshot, osim ako je to eksplicitno
    // potvrđeno (X-Confirm-Wipe zaglavlje). Ovo je druga razina obrane, uz
    // popravak na frontendu koji sprječava autosave prije uspješnog čitanja.
    const confirmWipe = req.get('X-Confirm-Wipe') === 'true';
    if (!confirmWipe && (!incoming.snapshots || incoming.snapshots.length === 0)) {
      const current = await db.getState();
      if (current.snapshots && current.snapshots.length > 0) {
        console.warn('Odbijen POST /api/state koji bi obrisao postojeće mjesece (prazan payload).');
        return res.status(409).json({ error: 'Odbijeno: dolazni podaci nemaju nijedan mjesec, a baza već sadrži podatke. Ovo bi obrisalo postojeću povijest.' });
      }
    }
    await db.saveState(incoming);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Spremanje u bazu nije uspjelo.' });
  }
});

// U produkciji/Dockeru posluži i gotov build frontenda (npm run build -> dist/)
const distPath = path.join(__dirname, 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server sluša na http://localhost:${PORT} (baza: ${usePostgres ? 'Postgres' : 'SQLite'})`);
});
