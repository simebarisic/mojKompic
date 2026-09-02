# Habit Tracker

Full-stack habit tracker: Spring Boot (Java 21) + React (Vite) + PostgreSQL, containerized with Docker.

## Pokretanje

Preduvjet: Docker i Docker Compose.

```bash
cp .env.example .env    # po potrebi izmijeni vrijednosti (JWT_SECRET obavezno u produkciji!)
docker compose up --build
```

- Frontend: http://localhost:3000
- Backend API: http://localhost:8080/api
- Postgres: localhost:5432

Prvo pokretanje automatski kreira shemu (Flyway migracije) i uvozi povijesne podatke iz Notiona.

## Arhitektura

```
habit-tracker/
├── backend/     Spring Boot 3 (Java 21), Spring Security + JWT, Spring Data JPA, Flyway
├── frontend/    React 19 + Vite, React Router, Recharts, Axios
└── docker-compose.yml
```

### Backend

- `POST /api/auth/register`, `POST /api/auth/login` — JWT autentikacija (bcrypt lozinke)
- `GET/POST/PUT/DELETE /api/habits` — CRUD za navike (svaki korisnik ima svoje)
- `GET /api/habits/logs?from=&to=` — matrica unosa za raspon datuma
- `POST /api/habits/logs/toggle` — označi/odznači naviku za dan
- `GET /api/stats?from=&to=` — statistika po navici (streak, najdulji niz, stopa uspješnosti) i dnevni napredak

Baza: PostgreSQL, sheme upravljane Flyway migracijama (`backend/src/main/resources/db/migration`).

### Frontend

- `/login`, `/register` — autentikacija
- `/` — dashboard s checklistom za zadnjih 7 dana
- `/habits` — dodavanje/uklanjanje/deaktivacija navika
- `/history` — graf dnevnog napretka + tablica streakova po navici
- `/profile` — promjena korisničkog imena, emaila i lozinke

## Lokalni razvoj bez Dockera

**Backend:**
```bash
cd backend
# pokreni lokalni Postgres ili prilagodi application.yml
mvn spring-boot:run
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev   # proxy prema http://localhost:8080 je već konfiguriran u vite.config.js
```

## CI/CD (GitHub Actions)

Workflow: `.github/workflows/ci.yml`

- **Na svaki push/PR prema `main`**: builda backend (`mvn clean verify`) i frontend (`npm ci && npm run build`) — hvata greške prije nego ih vidiš lokalno.
- **Na svaki push na `main`** (nakon što oba builda prođu): gradi Docker images za backend i frontend i pusha ih na GitHub Container Registry:
  - `ghcr.io/<owner>/<repo>-backend:latest`
  - `ghcr.io/<owner>/<repo>-frontend:latest`

Ne treba dodatan setup — koristi ugrađeni `GITHUB_TOKEN`, ali repo (Settings → Actions → General → Workflow permissions) treba imati dopušten "Read and write permissions" da bi push na GHCR prošao.

**Deploy korak nije uključen** jer još nemaš server na koji bi se deployalo. Kad odlučiš gdje app hosta (VPS, cloud, itd.), mogu dodati korak koji se preko SSH spaja na server, povlači nove images s GHCR-a i restarta `docker compose` — javi kad budeš spreman/na.

## Napomena o build provjeri

Frontend (`npm run build`) je uspješno testiran u ovom okruženju. Backend (Maven/Spring Boot) i Docker build nisu mogli biti pokrenuti u ovom sandboxu jer nema pristupa Maven Central repozitoriju niti pokrenutom Docker daemonu — kod je pažljivo ručno pregledan, ali preporučam da prvi `docker compose up --build` pokreneš i provjeriš na svom računalu prije nego ga smatraš gotovim.
