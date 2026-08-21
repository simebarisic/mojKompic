# Moj Kompić 📒

Osobna web aplikacija za mjesečno praćenje financijske imovine — likvidna imovina, mirovinski stupovi, obaveze, nekretnine, prihodi i rashodi.

Aplikacija radi u dva moda, bez izmjene koda:
- **Lokalno na Macu** (development) — baza je SQLite datoteka
- **Docker / home server** (produkcija) — baza je Postgres

Odabir je automatski: ako je postavljena `DATABASE_URL` varijabla, koristi se Postgres; inače SQLite.

## Značajke

- Pregled: neto vrijednost, promjena mjesec-na-mjesec, graf kretanja kroz vrijeme
- Dva donut grafa: likvidna imovina (bez nekretnina) i ukupna neto vrijednost (s nekretninama)
- Unos mjeseca s "kopiraj iz prošlog mjeseca"
- Dinamičke kategorije
- Povijest svih mjeseci s uređivanjem i brisanjem
- Praćenje prihoda i rashoda po mjesecu

## Tehnologije

- **Frontend:** React + Vite, Tailwind CSS, Recharts, lucide-react
- **Backend:** Node.js + Express
- **Baza:** SQLite (dev) ili Postgres (produkcija), preko zajedničkog adaptera u `db/`

---

## Lokalno pokretanje (Mac, SQLite)

### Preduvjeti
- [Node.js](https://nodejs.org) (LTS)

### Instalacija i pokretanje

```bash
npm install
npm run dev
```

Otvori `http://localhost:5173`. Podaci su u `moj-kompic.db` u korijenu projekta.

Ako `npm install` zapne na `better-sqlite3`:
```bash
xcode-select --install
npm install
```

---

## Docker / home server (Postgres)

### Pokretanje

```bash
docker compose up -d --build
```

Ovo pokrene dvije usluge:
- `db` — Postgres 16, podaci trajno spremljeni u Docker volumenu `kompic_db_data`
- `app` — build frontenda + backend, na portu `3001`

Aplikacija je dostupna na `http://<adresa-servera>:3001`.

**Prije prve upotrebe u produkciji promijeni lozinku** u `docker-compose.yml` (`POSTGRES_PASSWORD` i odgovarajući dio u `DATABASE_URL`) — vrijednost `change-me` je samo placeholder.

### Gašenje / zaustavljanje

```bash
docker compose down
```

Podaci ostaju u volumenu i preživljavaju restart/rebuild. `docker compose down -v` bi obrisao i volumen (podatke) — pazi s tim.

---

## CI/CD — automatski build na push

Na svaki push na `main` GitHub Actions (`.github/workflows/docker-publish.yml`) builda Docker image i pusha ga na GitHub Container Registry (GHCR), pod `ghcr.io/simebarisic/moj-kompic:latest` (i tag s kratkim SHA commita). Ne treba dodatna konfiguracija — koristi ugrađeni `GITHUB_TOKEN`.

Build je za `linux/amd64`. Ako je home server ARM (npr. Raspberry Pi), javi pa mijenjamo `platforms` u workflowu.

### Na home serveru: povlačenje gotovog image-a

Za produkciju na serveru koristi `docker-compose.prod.yml` umjesto `docker-compose.yml` — on ne builda lokalno nego povlači gotov image s GHCR-a:

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

Ako je repo privatan, GHCR paket je po defaultu također privatan pa se prvo treba prijaviti na serveru (jednom):

```bash
echo <GitHub_PAT_s_read:packages_pravom> | docker login ghcr.io -u simebarisic --password-stdin
```

(PAT napravi na GitHub → Settings → Developer settings → Personal access tokens, scope `read:packages`.) Alternativa: u GitHubu na packages stranici image-a postaviti ga na *public* pa login nije potreban.

Za ručno ažuriranje nakon svakog push-a ponovi `pull` + `up -d` gore. Za automatsko povlačenje najnovijeg tag-a bez ručne intervencije može se dodati [Watchtower](https://containrrr.dev/watchtower/) kao dodatna usluga koja provjerava GHCR i restarta `app` kad izađe novi image — javi ako to želiš pa dodajemo u `docker-compose.prod.yml`.

---

## Migracija postojećih podataka (SQLite → Postgres)

Kad prvi put prebaciš app na Docker/Postgres, pokreni migraciju **s Maca**, iz mape projekta gdje ti je postojeća `moj-kompic.db`:

```bash
export DATABASE_URL=postgres://kompic:change-me@<adresa-servera>:5432/kompic
npm run migrate:postgres
```

(Zamijeni lozinku i adresu servera stvarnim vrijednostima; ako Postgres port nije izložen izvana, migraciju možeš pokrenuti i unutar mreže servera, ili privremeno otvoriti port 5432.)

Skripta pročita sve iz SQLite baze i upiše u Postgres — kategorije, sve mjesece, iznose, prihode i rashode. Nakon migracije provjeri u appu da je sve tu prije nego obrišeš staru `.db` datoteku.

---

## Podaci i backup

- **SQLite (dev):** `moj-kompic.db` u korijenu projekta — kopiraj tu jednu datoteku za backup.
- **Postgres (produkcija):** podaci su u Docker volumenu `kompic_db_data`. Backup preko `pg_dump`:
  ```bash
  docker compose exec db pg_dump -U kompic kompic > backup.sql
  ```

Baza (i `.env`) su namjerno u `.gitignore`-u i ne idu na GitHub.

## Struktura projekta

```
moj-kompic/
├── server.js               # Express API (/api/state), bira SQLite ili Postgres
├── db/
│   ├── sqlite.js            # adapter za lokalni dev
│   └── postgres.js          # adapter za Docker/produkciju
├── scripts/
│   └── migrate-to-postgres.js
├── src/
│   ├── App.jsx               # cijela aplikacija (UI, grafovi, logika)
│   ├── main.jsx
│   └── index.css
├── Dockerfile
├── docker-compose.yml
├── index.html
├── vite.config.js
└── tailwind.config.js
```

## Napomena o privatnosti

Ovo je osobni alat za praćenje financija — drži repozitorij **privatnim** na GitHubu. Baza i `.env` su izuzeti iz gita, ali kod otkriva strukturu tvog portfelja (nazivi brokera, mirovinskih stupova i sl.).

## Ideje za dalje

- [ ] Izvoz/uvoz podataka (JSON ili CSV)
- [ ] Godišnji pregledi i usporedba godina
- [ ] Grafikon FIRE napretka prema cilju umirovljenja