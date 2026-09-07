// Jednokratni uvoz ulaganja iz Notion "Investment Journal" predloška u tab
// "Ulaganja" ove aplikacije. Čita notion-investments-raw.json (izvezeno iz
// Notion baza "Investments" i "Past Investments" preko Notion MCP-a),
// mapira ih u format aplikacije i SPAJA s postojećim stanjem u bazi -
// ne briše ništa što već postoji (kategorije, mjeseci, plemeniti metali...).
// Sigurno je pokrenuti više puta: retci koji već postoje (isti naziv +
// datum kupnje + kupovna cijena + količina) se ne dupliciraju - ako
// notion-investments-raw.json u međuvremenu ima stvaran Notion komentar za
// taj redak (polje "comment") koji se razlikuje od trenutne napomene u
// bazi, napomena tog retka se AŽURIRA (sve ostalo - trenutna cijena koju si
// možda ručno upisao u appu, id, itd. - ostaje netaknuto).
//
// Pokretanje lokalno (SQLite, iz mape projekta):
//   node scripts/import-notion-investments.js
// Pokretanje protiv Postgresa (npr. na mordoru):
//   DATABASE_URL=postgres://... node scripts/import-notion-investments.js

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const usePostgres = !!process.env.DATABASE_URL;
const db = usePostgres ? await import('../db/postgres.js') : await import('../db/sqlite.js');

const uid = () => Math.random().toString(36).slice(2, 9);

// Notion "Investment Type" (select opcije iz oba izvora) -> vrsta u appu.
const TYPE_MAP = {
  FD: 'Oročeni depozit',
  Gold: 'Zlato',
  Stock: 'Dionica',
  Stocks: 'Dionica',
  'Mutual fund': 'Uzajamni fond',
  'Mutual Funds': 'Uzajamni fond',
  Bond: 'Obveznica',
  Bonds: 'Obveznica',
  Cryptocurrency: 'Kriptovaluta',
  Silver: 'Srebro',
  ETFs: 'ETF',
  'Index Funds': 'Indeksni fond',
  'Real Estate': 'Nekretnina',
  Cash: 'Gotovina',
  'Commodities (Other)': 'Roba/ostalo',
};
const mapType = (t) => TYPE_MAP[t] || 'Roba/ostalo';

// Notion datumi su puni ISO datumi (YYYY-MM-DD); app koristi mjesečnu
// granularnost (YYYY-MM), isto kao ostatak aplikacije (Unos, Potrošna imovina...).
const toMonthStr = (isoDate) => (isoDate ? isoDate.slice(0, 7) : null);

// Ako za redak postoji stvaran Notion komentar (npr. "150 €", detalji o
// čistoći srebra, trošak nekretnine...), koristi njega kao napomenu; inače
// generički tekst kao i dosad.
const FALLBACK_NOTE = 'Uvezeno iz Notion Investment Journala';
const noteFor = (r) => (r.comment && String(r.comment).trim() ? String(r.comment).trim() : FALLBACK_NOTE);

function main() {
  const rawPath = path.join(__dirname, 'notion-investments-raw.local.json');
  if (!fs.existsSync(rawPath)) {
    console.error(
      `Nedostaje ${rawPath}.\n` +
      'Ova skripta uvozi iz tvog osobnog Notion exporta - taj fajl namjerno NIJE ' +
      'u git repozitoriju (sadrži stvarne financijske podatke). Ako ti ponovno ' +
      'zatreba, izvezi ponovno iz Notiona ili ga vrati iz lokalnog backupa.'
    );
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(rawPath, 'utf8'));

  const candidates = [];

  // "Investments" (aktivna) baza - preskoči retke bez datuma kupnje ili s
  // kupovnom cijenom 0 (izgledaju kao prazan/placeholder red iz predloška,
  // ne stvarno ulaganje). Ako je ovo stvarno tvoj podatak, javi pa ga ručno
  // dodamo kroz UI (Ulaganja -> Dodaj ulaganje).
  (raw.investmentsDb || []).forEach((r) => {
    if (!r.buyDate || !r.buyPrice) {
      console.log(`Preskačem "${r.name}" iz Investments baze (nema datum kupnje i/ili kupovnu cijenu > 0 - izgleda kao prazan red iz predloška).`);
      return;
    }
    candidates.push({
      label: r.name, type: mapType(r.type), buyDate: toMonthStr(r.buyDate),
      buyPrice: Number(r.buyPrice), quantity: Number(r.quantity) || 1,
      currentPrice: r.currentPrice === null || r.currentPrice === undefined ? null : Number(r.currentPrice),
      sellDate: null, sellPrice: null, notes: noteFor(r),
    });
  });

  // "Past Investments" baza - unatoč nazivu, retci BEZ Sell Price/Sell date
  // su i dalje aktivne pozicije (samo su ovdje logirane), pa ih uvozimo kao
  // aktivna ulaganja; retci SA sell price/date uvozimo kao prodana.
  (raw.pastInvestmentsDb || []).forEach((r) => {
    const sold = r.sellPrice !== null && r.sellPrice !== undefined;
    candidates.push({
      label: r.name, type: mapType(r.type), buyDate: toMonthStr(r.buyDate),
      buyPrice: Number(r.buyPrice), quantity: Number(r.quantity) || 1,
      currentPrice: null,
      sellDate: sold ? toMonthStr(r.sellDate) : null,
      sellPrice: sold ? Number(r.sellPrice) : null,
      notes: noteFor(r),
    });
  });

  return candidates;
}

async function run() {
  const candidates = main();

  await db.init();
  const state = await db.getState();
  const existing = state.investments || [];

  const key = (inv) => `${inv.label}|${inv.buyDate}|${inv.buyPrice}|${inv.quantity}`;
  const existingByKey = new Map(existing.map((e) => [key(e), e]));

  const toAdd = [];
  const merged = existing.map((e) => ({ ...e }));
  let updatedNotes = 0;

  candidates.forEach((c) => {
    const match = existingByKey.get(key(c));
    if (!match) {
      toAdd.push({ id: uid(), ...c });
      return;
    }
    // Redak već postoji u bazi - ne dupliciramo ga, ali ako iz Notiona sad
    // imamo stvaran komentar koji se razlikuje od trenutne napomene (npr.
    // stari generički tekst od prošlog uvoza), ažuriramo samo napomenu.
    // Sve ostalo (id, ručno upisana trenutna cijena...) ostaje netaknuto.
    if (c.notes && c.notes !== match.notes) {
      const idx = merged.findIndex((m) => m.id === match.id);
      if (idx !== -1) {
        merged[idx] = { ...merged[idx], notes: c.notes };
        updatedNotes++;
      }
    }
  });

  const skipped = candidates.length - toAdd.length;

  if (toAdd.length === 0 && updatedNotes === 0) {
    console.log(`Nema ništa novo za uvoz ni ažurirati (${skipped} redaka već postoji u bazi, napomene su već ažurne).`);
    process.exit(0);
  }

  const newInvestments = [...merged, ...toAdd];
  await db.saveState({ ...state, investments: newInvestments });

  if (toAdd.length > 0) {
    console.log(`Uvezeno ${toAdd.length} novih ulaganja iz Notiona (${skipped} preskočeno jer već postoje).`);
    const activeCount = toAdd.filter((i) => !i.sellDate).length;
    console.log(`  - aktivnih: ${activeCount}`);
    console.log(`  - prodanih: ${toAdd.length - activeCount}`);
  }
  if (updatedNotes > 0) {
    console.log(`Ažurirana napomena (Notion komentar) na ${updatedNotes} već postojećih ulaganja.`);
  }
  console.log('Napomena: "Trenutna cijena" nije automatski postavljena za aktivne pozicije (osim ako je već bila upisana u Notionu) - ažuriraj ih ručno u tabu "Ulaganja" kad želiš vidjeti stvaran prinos.');
  process.exit(0);
}

run().catch((e) => {
  console.error('Uvoz nije uspio:', e);
  process.exit(1);
});
