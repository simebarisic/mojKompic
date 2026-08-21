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
