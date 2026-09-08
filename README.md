# Moj Kompić

Osobni tracker neto vrijednosti i financija. React (Vite) frontend + Express
backend, SQLite lokalno ili Postgres u Dockeru.

## Pokretanje lokalno (bez Dockera, SQLite)

```bash
npm install
npm run dev
```

Frontend: http://localhost:5173 (Vite dev server, proxy prema backendu)
Backend API: http://localhost:3001

Baza je lokalni `moj-kompic.db` (SQLite), kreira se automatski.

## Pokretanje s Dockerom (Postgres)

```bash
cp .env.example .env    # postavi POSTGRES_PASSWORD na jaku lozinku
docker compose up --build
```

App: http://localhost:3001

## Demo instanca

Zasebna instanca s izmišljenim podacima, odvojena baza/port - vidi komentare
na vrhu `docker-compose.demo.yml`.

## Prijava lozinkom (samo prava instanca)

Prava instanca (`docker-compose.yml` / `docker-compose.prod.yml`) može tražiti
lozinku prije prikaza aplikacije - jednostavna sesijska prijava, bez korisničkih
računa. Demo instanca (`docker-compose.demo.yml`) namjerno OSTAJE bez prijave.

Uključivanje:

```bash
npm run hash-password        # upiši lozinku, dobiješ bcrypt hash
```

Zalijepi ispisani `AUTH_PASSWORD_HASH=...` u `.env` (vidi `.env.example`).
Bez postavljenog `AUTH_PASSWORD_HASH`, aplikacija radi kao dosad, bez prijave.

Ako je instanca iza HTTPS-a (npr. kad mordor dobije domenu/Nginx), postavi i
`COOKIE_SECURE=true` u `.env`.

Deploy preko `moj-kompic-deploy.yml` prepisuje `.env` na mordoru iz GitHub
Secreta pri svakom pokretanju - da prijava preživi deploy, dodaj u repo
(Settings → Secrets and variables → Actions, `production` environment):
`AUTH_PASSWORD_HASH`, `SESSION_SECRET` (Secrets) i po želji `COOKIE_SECURE`
(Variables).

## Osobni podaci (.local. fajlovi)

`db/generational-wealth-seed-data.js` i `scripts/import-notion-investments.js`
učitavaju stvarne osobne podatke iz `*.local.js` / `*.local.json` fajlova ako
postoje (vidi `.gitignore`) - ti fajlovi se namjerno ne commitaju. Bez njih
app radi normalno, samo bez pred-punjenih redaka.

## Arhitektura

```
moj-kompic/
├── server.js              Express backend + API rute
├── db/postgres.js         DB adapter (Postgres)
├── db/sqlite.js           DB adapter (SQLite)
├── src/App.jsx            React frontend (sve komponente/tabovi)
└── scripts/               jednokratne uvozne/migracijske skripte
```

## CI/CD (GitHub Actions)

- `.github/workflows/moj-kompic-ci.yml` — na svaki push na `main`: builda i
  pusha Docker image na `ghcr.io/simebarisic/moj-kompic`.
- `.github/workflows/moj-kompic-deploy.yml` — **ručni** deploy (workflow_dispatch)
  na mordor preko SSH-a; namjerno nema automatski `on: push` deploy, to je
  besplatni ekvivalent "required reviewers" gatea. Treba GitHub Secrets:
  `MORDOR_HOST`, `MORDOR_USER`, `MORDOR_SSH_KEY`, `POSTGRES_PASSWORD`,
  `AUTH_PASSWORD_HASH`, `SESSION_SECRET` (vidi "Prijava lozinkom" iznad) i
  po želji Variable `COOKIE_SECURE`.
