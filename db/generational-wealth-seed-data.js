// Početni sadržaj taba "Generacijsko bogatstvo". Stvarni, OSOBNI popis
// (nasljedstvo, wishlist) namjerno NIJE u ovom (public) repozitoriju - živi
// lokalno u db/generational-wealth-seed-data.local.js, koji je u .gitignore.
// Ako taj fajl ne postoji (npr. svjež clone repoa), koristi se prazan popis -
// app normalno radi, samo bez pred-punjenih redaka. Format .local.js fajla:
//   export const GENERATIONAL_WEALTH_SEED = [{ category, itemDate, content }, ...]
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const localPath = path.join(__dirname, 'generational-wealth-seed-data.local.js');

export let GENERATIONAL_WEALTH_SEED = [];
if (fs.existsSync(localPath)) {
  ({ GENERATIONAL_WEALTH_SEED } = await import(localPath));
}
