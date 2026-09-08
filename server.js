import express from 'express';
import session from 'express-session';
import bcrypt from 'bcryptjs';
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

// ---- Jednostavna zaštita lozinkom (samo za "pravu" instancu) ----
// Uključuje se SAMO ako je postavljen AUTH_PASSWORD_HASH (bcrypt hash lozinke
// - generiraj ga s "npm run hash-password", vidi scripts/generate-password-hash.js).
// docker-compose.demo.yml namjerno ne postavlja ovu varijablu, pa demo instanca
// ostaje bez prijave. Sesija je obična cookie-sesija u memoriji servera (nema
// vanjske baze za sesije) - dovoljno za jednog korisnika; restart servera
// jednostavno traži ponovnu prijavu.
const AUTH_PASSWORD_HASH = process.env.AUTH_PASSWORD_HASH || '';
const AUTH_ENABLED = !!AUTH_PASSWORD_HASH;

// Jednostavno ograničenje pokušaja prijave (u memoriji, po IP-u) - obrana od
// automatiziranog pogađanja lozinke. Resetira se pri restartu servera, što je
// prihvatljivo za osobnu aplikaciju s jednim korisnikom.
const loginAttempts = new Map(); // ip -> { count, blockedUntil }
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_BLOCK_MS = 15 * 60 * 1000; // 15 min

function isLoginBlocked(ip) {
  const a = loginAttempts.get(ip);
  if (!a?.blockedUntil) return false;
  if (Date.now() > a.blockedUntil) { loginAttempts.delete(ip); return false; }
  return true;
}
function recordFailedLogin(ip) {
  const a = loginAttempts.get(ip) || { count: 0, blockedUntil: null };
  a.count += 1;
  if (a.count >= MAX_LOGIN_ATTEMPTS) a.blockedUntil = Date.now() + LOGIN_BLOCK_MS;
  loginAttempts.set(ip, a);
}
function clearLoginAttempts(ip) {
  loginAttempts.delete(ip);
}

function renderLoginPage({ error } = {}) {
  return `<!doctype html>
<html lang="hr">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Moj Kompić — Prijava</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: #12151b; color: #eae6db;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  form {
    background: #1a1f28; border: 1px solid #2b3341; border-radius: 12px;
    padding: 32px 28px; width: 100%; max-width: 320px;
  }
  h1 { font-size: 18px; margin: 0 0 4px; font-weight: 600; }
  p.sub { font-size: 13px; color: #93a0b5; margin: 0 0 20px; }
  label { font-size: 12px; color: #5d6577; display: block; margin-bottom: 6px; }
  input[type="password"] {
    width: 100%; padding: 9px 11px; border-radius: 8px; border: 1px solid #2b3341;
    background: #12151b; color: #eae6db; font-size: 14px; margin-bottom: 14px;
  }
  input[type="password"]:focus { outline: none; border-color: #c9a227; }
  button {
    width: 100%; padding: 10px; border-radius: 8px; border: none;
    background: #e7c565; color: #12151b; font-weight: 600; font-size: 14px; cursor: pointer;
  }
  button:hover { background: #c9a227; }
  .error { color: #c16a48; font-size: 13px; margin: -6px 0 14px; }
</style>
</head>
<body>
  <form method="POST" action="/login">
    <h1>Moj Kompić</h1>
    <p class="sub">Unesi lozinku za pristup.</p>
    ${error ? `<div class="error">${error}</div>` : ''}
    <label for="password">Lozinka</label>
    <input type="password" id="password" name="password" autofocus required />
    <button type="submit">Prijavi se</button>
  </form>
</body>
</html>`;
}

if (AUTH_ENABLED) {
  // Ako je server iza reverse proxyja (Nginx/Cloudflare) - poštuje X-Forwarded-*
  // (bitno za req.ip u rate-limitu i za "secure" cookie iza HTTPS-terminatora).
  app.set('trust proxy', 1);

  app.use(session({
    name: 'kompic.sid',
    secret: process.env.SESSION_SECRET || 'promijeni-me-postavi-SESSION_SECRET-u-.env',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      // Postavi COOKIE_SECURE=true u .env kad instanca bude iza HTTPS-a
      // (npr. kad mordor dobije domenu/Nginx) - dok je na http://localhost
      // ili http://IP bez HTTPS-a, MORA ostati false, inače preglednik
      // odbija poslati cookie i prijava izgleda kao da ne radi.
      secure: process.env.COOKIE_SECURE === 'true',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 dana
    },
  }));

  app.get('/login', (req, res) => {
    if (req.session?.authenticated) return res.redirect('/');
    res.type('html').send(renderLoginPage());
  });

  app.post('/login', express.urlencoded({ extended: false }), async (req, res) => {
    const ip = req.ip;
    if (isLoginBlocked(ip)) {
      return res.status(429).type('html').send(renderLoginPage({ error: 'Previše pokušaja. Pokušaj ponovno za 15 minuta.' }));
    }
    const password = (req.body?.password || '').toString();
    let ok = false;
    try {
      ok = password.length > 0 && await bcrypt.compare(password, AUTH_PASSWORD_HASH);
    } catch (e) {
      console.error('Provjera lozinke nije uspjela:', e.message);
    }
    if (ok) {
      clearLoginAttempts(ip);
      req.session.authenticated = true;
      return req.session.save(() => res.redirect('/'));
    }
    recordFailedLogin(ip);
    res.status(401).type('html').send(renderLoginPage({ error: 'Pogrešna lozinka.' }));
  });

  app.get('/logout', (req, res) => {
    req.session?.destroy(() => res.redirect('/login'));
  });
  app.post('/logout', (req, res) => {
    req.session?.destroy(() => res.redirect('/login'));
  });

  app.get('/api/auth-status', (req, res) => {
    res.json({ enabled: true, authenticated: !!req.session?.authenticated });
  });

  // Vrata: sve ostalo (API rute i statični frontend ispod) traži prijavu.
  app.use((req, res, next) => {
    if (req.session?.authenticated) return next();
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Potrebna je prijava.' });
    res.redirect('/login');
  });
} else {
  app.get('/api/auth-status', (req, res) => res.json({ enabled: false, authenticated: true }));
}

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

// Tečaj valuta -> EUR za kategorije s valutom != EUR u mjesečnom "Unosu"
// (npr. USD). Koristi isti keš/izvor (frankfurter.dev) kao cijene metala i
// ulaganja - vidi getFxRateToEur gore. Kod pada izvora vraća zadnji poznati
// tečaj iz keša (bolje star nego nikakav), isto kao /api/metal-prices.
app.get('/api/fx-rate', async (req, res) => {
  const currency = (req.query.currency || 'USD').toString().toUpperCase();
  try {
    const fx = await getFxRateToEur(currency);
    res.json({ currency, rate: fx.rate, date: fx.date, stale: false });
  } catch (e) {
    console.error(`Dohvat tečaja za "${currency}" nije uspio:`, e.message);
    const stale = fxRateCache.get(currency);
    if (stale) {
      return res.json({ currency, rate: stale.rate, date: stale.date, stale: true });
    }
    res.status(502).json({ error: `Ne mogu dohvatiti tečaj za valutu "${currency}". Pokušaj kasnije.` });
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
