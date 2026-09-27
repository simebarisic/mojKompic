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
├── scripts/               jednokratne uvozne/migracijske skripte (+ k8s-local.sh)
└── k8s/                   Kubernetes manifesti (Kustomize) - vidi sekciju Kubernetes
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
- `.github/workflows/moj-kompic-k8s.yml` — na svaki PR/push validira Kubernetes
  manifeste i napravi test deploy na efemerni k3d klaster (vidi sekciju Kubernetes).

## Kubernetes (lokalno, za učenje)

Manifesti su u `k8s/` i složeni su s Kustomizeom (ugrađen u `kubectl`):

```
k8s/
├── base/                  zajedničko za sve okoline
│   ├── app.yaml           Deployment + Service (probe, securityContext, initContainer)
│   ├── postgres.yaml      StatefulSet + headless Service + PVC
│   ├── ingress.yaml       Ingress s TLS-om
│   └── backup.yaml        CronJob: dnevni pg_dump u zaseban PVC (čuva 7 dana)
└── overlays/
    ├── local/             k3d + Traefik + cert-manager, https://kompic.localtest.me
    └── ci/                za GitHub Actions (bez Ingressa, testni secreti)
```

Preduvjeti: Docker Desktop + `brew install k3d kubectl`.

```bash
./scripts/k8s-local.sh up        # klaster + cert-manager + build + deploy
./scripts/k8s-local.sh status    # podovi, PVC-ovi, certifikat...
./scripts/k8s-local.sh deploy    # nakon promjene koda: rebuild + rollout
./scripts/k8s-local.sh backup    # ručni backup baze
./scripts/k8s-local.sh trust-ca  # macOS vjeruje lokalnom CA -> HTTPS bez upozorenja
./scripts/k8s-local.sh down      # briše klaster (i podatke!)
```

`up` pri prvom pokretanju kreira `k8s/overlays/local/secret.env` s nasumičnim
lozinkama (nije u gitu, vidi `secret.env.example`). Za prijavu lozinkom dodaj
`AUTH_PASSWORD_HASH` u taj fajl i pokreni `deploy`.

Korisne naredbe za učenje:

```bash
kubectl -n moj-kompic get pods -w                       # prati podove uživo
kubectl -n moj-kompic describe pod -l app.kubernetes.io/name=moj-kompic
kubectl -n moj-kompic exec -it postgres-0 -- psql -U kompic
kubectl kustomize k8s/overlays/local                     # vidi generirani YAML
```

Restore iz backupa:

```bash
kubectl -n moj-kompic run restore --rm -it --image=postgres:16-alpine \
  --overrides='{"spec":{"volumes":[{"name":"b","persistentVolumeClaim":{"claimName":"postgres-backups"}}],"containers":[{"name":"restore","image":"postgres:16-alpine","stdin":true,"tty":true,"command":["sh"],"volumeMounts":[{"name":"b","mountPath":"/backups"}]}]}}'
# u shellu:  ls /backups && gunzip -c /backups/kompic-XXXX.sql.gz | PGPASSWORD=... psql -h postgres -U kompic kompic
```

Health endpointi (rade i kad je uključena prijava): `/healthz` (liveness,
ne dira bazu) i `/readyz` (readiness, provjerava bazu). Server na SIGTERM
završi započete zahtjeve i zatvori bazu (graceful shutdown).

Aplikacija namjerno ide s **1 replikom** jer su sesije u memoriji procesa.

CI: `.github/workflows/moj-kompic-k8s.yml` na svaki PR/push validira manifeste
(kubeconform) i digne efemerni k3d klaster na runneru, deploya `overlays/ci`,
napravi smoke test (`/healthz`, `/readyz`, `/api/state`, frontend) i testni backup.

## OpenShift Local (CRC) - pilot

Isti `k8s/base` deployan na OpenShift: Route umjesto Ingressa, BuildConfig i
ImageStream umjesto lokalnog builda, SCC restricted-v2 (nasumični UID),
Postgres iz sclorg imagea. Pokretanje: `./scripts/openshift-local.sh up`.
Detalji i usporedba s k3d-om: [`openshift/README.md`](openshift/README.md).
