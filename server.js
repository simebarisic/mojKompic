import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import YahooFinance from 'yahoo-finance2';
import { GENERATIONAL_WEALTH_SEED } from './db/generational-wealth-seed-data.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Neslužbena Yahoo Finance biblioteka (nema formalnog API ključa, ali povremeno
// zna zapeti ako Yahoo promijeni cookie/crumb mehanizam - vidi fetchStockPriceEUR).
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

// Bira bazu: ako je postavljen DATABASE_URL (Docker/Postgres), koristi Postgres.
// Inače (lokalni dev na Macu), koristi lokalnu SQLite datoteku.
const usePostgres = !!process.env.DATABASE_URL;
const db = usePostgres ? await import('./db/postgres.js') : await import('./db/sqlite.js');

await db.init();

// Auto-sjeme za tab "Generacijsko bogatstvo": ako baza (nova ili postojeća)
// još nema NIJEDNU stavku u tom tabu, popuni je sadržajem prenesenim s
// istoimene Notion stranice (vidi db/generational-wealth-seed-data.js).
// Provjerava se pri svakom pokretanju servera, ali čim postoji barem jedna
// stavka (iz ovog sjemena ili ručno dodana kroz UI), ovo se više NE pokreće -
// pa je sigurno da restart servera ne prebriše ono što si ručno uredio/obrisao.
try {
  const startupState = await db.getState();
  if (!startupState.wealthItems || startupState.wealthItems.length === 0) {
    const seeded = GENERATIONAL_WEALTH_SEED.map((r) => ({ id: Math.random().toString(36).slice(2, 9), ...r }));
    await db.saveState({ ...startupState, wealthItems: seeded });
    console.log(`Generacijsko bogatstvo: uvezeno ${seeded.length} početnih stavki iz Notiona (baza je bila prazna za taj tab).`);
  }
} catch (e) {
  console.error('Auto-uvoz "Generacijsko bogatstvo" nije uspio (nastavljam bez njega):', e.message);
}

const app = express();
app.use(express.json({ limit: '5mb' }));

// ---- Zajednički tečaj bilo_koja_valuta->EUR (koriste ga i cijene metala i
// cijene dionica) ---- Dohvaća se s api.frankfurter.dev (ECB, bez API ključa,
// podržava sve ISO valute koje ECB objavljuje - USD, JPY, GBP, CHF...) i
// kešira 10 min po valuti, isto kao i cijene ispod, da se izvor ne zove na
// svaki render/refresh.
const PRICE_CACHE_MS = 10 * 60 * 1000; // 10 min
const fxRateCache = new Map(); // valuta (npr. "USD") -> { rate, date, fetchedAt }

async function getFxRateToEur(currency) {
  const code = (currency || 'EUR').toUpperCase();
  if (code === 'EUR') return { rate: 1, date: null };
  const now = Date.now();
  const cached = fxRateCache.get(code);
  if (cached && now - cached.fetchedAt < PRICE_CACHE_MS) return cached;
  const res = await fetch(`https://api.frankfurter.dev/v1/latest?from=${encodeURIComponent(code)}&to=EUR`);
  if (!res.ok) throw new Error(`Tečaj za valutu "${code}" nije dostupan.`);
  const fx = await res.json();
  const rate = fx?.rates?.EUR;
  if (!rate) throw new Error(`Nepoznata ili nepodržana valuta "${code}".`);
  const data = { rate, date: fx.date || null, fetchedAt: now };
  fxRateCache.set(code, data);
  return data;
}

// ---- Cijene zlata/srebra (za tab "Plemeniti metali") ----
// Dohvaća spot cijenu s api.gold-api.com (USD/trojskoj unci, bez API ključa),
// pa pretvara u EUR po gramu preko tečaja gore. Rezultat se kešira u memoriji
// da se izvori ne zovu na svaki render/refresh (i da app preživi kratkotrajne
// ispade tih servisa).
const GRAMS_PER_TROY_OUNCE = 31.1034768;
let metalPriceCache = { data: null, fetchedAt: 0 };

async function fetchMetalPrices() {
  const [xauRes, xagRes, fx] = await Promise.all([
    fetch('https://api.gold-api.com/price/XAU'),
    fetch('https://api.gold-api.com/price/XAG'),
    getFxRateToEur('USD'),
  ]);
  if (!xauRes.ok || !xagRes.ok) throw new Error('Izvor cijene metala nije dostupan.');
  const [xau, xag] = await Promise.all([xauRes.json(), xagRes.json()]);
  const usdToEur = fx.rate;
  if (!xau?.price || !xag?.price || !usdToEur) throw new Error('Nepotpun odgovor izvora cijena.');

  const toEurPerGram = (usdPerOz) => (usdPerOz / GRAMS_PER_TROY_OUNCE) * usdToEur;

  return {
    gold: { eurPerGram: toEurPerGram(xau.price), usdPerOz: xau.price, updatedAt: xau.updatedAt || null },
    silver: { eurPerGram: toEurPerGram(xag.price), usdPerOz: xag.price, updatedAt: xag.updatedAt || null },
    fx: { usdToEur, date: fx.date },
    fetchedAt: new Date().toISOString(),
  };
}

// ---- Cijene ulaganja (za tab "Ulaganja": Dionica/ETF/fondovi + Kriptovaluta) ----
// Dionice/ETF/fondovi: Yahoo Finance (neslužbeno, preko paketa "yahoo-finance2"
// - Yahoo nema javni/službeni API pa se ovo oslanja na isti "cookie+crumb"
// trik kao yfinance u Pythonu i slično; može povremeno zapeti ako Yahoo
// promijeni mehanizam, vidi grešku niže). Ticker je isti kao na finance.yahoo.com
// (npr. "AAPL", "VWCE.DE", "3350.T" za Tokio) - VALUTA se čita izravno iz
// Yahoovog odgovora (quote.currency), korisnik je ne mora birati ručno.
// Kriptovalute: CoinGecko (https://www.coingecko.com), besplatan izvor bez API
// ključa, preko CoinGecko ID-a (npr. "bitcoin") - ne preko simbola (BTC/ETH
// nisu jedinstveni ID-jevi na CoinGeckou), s cijenom izravno u EUR.
// Oboje se kešira po pojedinom simbolu/ID-u 10 min, isto kao cijene metala.
const investmentPriceCache = new Map(); // key: "stock:AAPL" / "crypto:bitcoin" -> { data, fetchedAt }

function getCachedPrice(key) {
  const cached = investmentPriceCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < PRICE_CACHE_MS) return cached.data;
  return null;
}

async function fetchStockPriceEUR(symbol) {
  const key = `stock:${symbol}`;
  const cached = getCachedPrice(key);
  if (cached) return cached;

  let quote;
  try {
    quote = await yahooFinance.quote(symbol);
  } catch (e) {
    console.warn(`Yahoo Finance greška za "${symbol}": ${e.message}`);
    throw new Error(`Yahoo Finance nije dostupan za "${symbol}" (${e.message}).`);
  }
  const price = quote?.regularMarketPrice;
  const sourceCurrency = (quote?.currency || '').toUpperCase();
  if (!price || !sourceCurrency) {
    throw new Error(`Ticker "${symbol}" nije pronađen na Yahoo Financeu.`);
  }

  let priceEur = price;
  if (sourceCurrency !== 'EUR') {
    const fx = await getFxRateToEur(sourceCurrency);
    priceEur = price * fx.rate;
  }

  const data = { price: priceEur, currency: 'EUR', sourceCurrency, sourcePrice: price, fetchedAt: new Date().toISOString() };
  investmentPriceCache.set(key, { data, fetchedAt: Date.now() });
  return data;
}

async function fetchCryptoPricesEUR(ids) {
  const now = Date.now();
  const result = {};
  const missing = [];
  ids.forEach((id) => {
    const cached = getCachedPrice(`crypto:${id}`);
    if (cached) result[id] = cached; else missing.push(id);
  });
  if (missing.length === 0) return result;

  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(missing.join(','))}&vs_currencies=eur`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('CoinGecko nije dostupan.');
  const body = await res.json();
  missing.forEach((id) => {
    const eur = body?.[id]?.eur;
    if (eur === undefined) {
      result[id] = { error: `CoinGecko ID "${id}" nije pronađen.` };
    } else {
      const data = { price: eur, currency: 'EUR', fetchedAt: new Date().toISOString() };
      investmentPriceCache.set(`crypto:${id}`, { data, fetchedAt: now });
      result[id] = data;
    }
  });
  return result;
}

app.post('/api/investment-prices', async (req, res) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];

    // Deduplicirano po simbolu/ID-u, da isti ticker unesen na više ulaganja
    // (npr. više kupnji istog ETF-a) ne izazove više paralelnih poziva istom izvoru.
    const stockSymbols = new Set();
    const cryptoIds = new Set();
    items.forEach((i) => {
      const symbol = (i.symbol || '').trim();
      if (!symbol) return;
      if (i.kind === 'crypto') cryptoIds.add(symbol);
      else if (i.kind === 'stock') stockSymbols.add(symbol);
    });

    const prices = {};
    const errors = {};

    await Promise.all([...stockSymbols].map(async (symbol) => {
      try {
        prices[`stock:${symbol}`] = await fetchStockPriceEUR(symbol);
      } catch (e) {
        errors[`stock:${symbol}`] = e.message || 'Dohvat nije uspio.';
      }
    }));

    if (cryptoIds.size > 0) {
      try {
        const cryptoResult = await fetchCryptoPricesEUR([...cryptoIds]);
        Object.entries(cryptoResult).forEach(([id, val]) => {
          if (val.error) errors[`crypto:${id}`] = val.error;
          else prices[`crypto:${id}`] = val;
        });
      } catch (e) {
        cryptoIds.forEach((id) => { errors[`crypto:${id}`] = e.message || 'Dohvat nije uspio.'; });
      }
    }

    res.json({ prices, errors, fetchedAt: new Date().toISOString() });
  } catch (e) {
    console.error('Dohvat cijena ulaganja nije uspio:', e.message);
    res.status(502).json({ error: 'Dohvat cijena ulaganja nije uspio.' });
  }
});

app.get('/api/metal-prices', async (req, res) => {
  const now = Date.now();
  if (metalPriceCache.data && now - metalPriceCache.fetchedAt < PRICE_CACHE_MS) {
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
