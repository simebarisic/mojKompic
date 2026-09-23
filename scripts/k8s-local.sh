#!/usr/bin/env bash
# Lokalni Kubernetes za Moj Kompić: k3d (k3s u Dockeru) + Traefik + cert-manager.
#
#   ./scripts/k8s-local.sh up        kreira klaster (ako ne postoji), builda image i deploya
#   ./scripts/k8s-local.sh deploy    samo rebuild imagea + ponovni deploy (nakon promjene koda)
#   ./scripts/k8s-local.sh status    pregled podova, servisa, ingressa, certifikata
#   ./scripts/k8s-local.sh logs      prati logove aplikacije
#   ./scripts/k8s-local.sh backup    ručno pokreni backup baze (Job iz CronJoba)
#   ./scripts/k8s-local.sh trust-ca  doda lokalni CA u macOS Keychain (HTTPS bez upozorenja)
#   ./scripts/k8s-local.sh down      obriše cijeli klaster (i sve podatke u njemu!)
#
# Treba: Docker Desktop (upaljen), k3d, kubectl  ->  brew install k3d kubectl
set -euo pipefail

CLUSTER=moj-kompic
NS=moj-kompic
IMAGE=moj-kompic:local
HOST=kompic.localtest.me   # *.localtest.me javni DNS uvijek vraća 127.0.0.1
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OVERLAY="$ROOT/k8s/overlays/local"
CERT_MANAGER_URL=https://github.com/cert-manager/cert-manager/releases/latest/download/cert-manager.yaml

need() { command -v "$1" >/dev/null || { echo "Nedostaje '$1'. Instaliraj: brew install $2" >&2; exit 1; }; }

ensure_secret_env() {
  if [ ! -f "$OVERLAY/secret.env" ]; then
    echo "==> Kreiram $OVERLAY/secret.env s nasumičnim lozinkama (bez prijave; dodaj AUTH_PASSWORD_HASH po želji)"
    cat > "$OVERLAY/secret.env" <<ENV
POSTGRES_PASSWORD=$(openssl rand -hex 24)
AUTH_PASSWORD_HASH=
SESSION_SECRET=$(openssl rand -hex 32)
ENV
  fi
}

create_cluster() {
  if k3d cluster list "$CLUSTER" >/dev/null 2>&1; then
    echo "==> Klaster '$CLUSTER' već postoji"
  else
    echo "==> Kreiram k3d klaster '$CLUSTER' (portovi 80/443 -> Traefik)"
    k3d cluster create "$CLUSTER" \
      --agents 1 \
      -p "80:80@loadbalancer" \
      -p "443:443@loadbalancer" \
      --wait
  fi
  kubectl config use-context "k3d-$CLUSTER" >/dev/null

  if ! kubectl get ns cert-manager >/dev/null 2>&1; then
    echo "==> Instaliram cert-manager"
    kubectl apply -f "$CERT_MANAGER_URL"
  fi
  echo "==> Čekam cert-manager..."
  kubectl -n cert-manager rollout status deploy/cert-manager-webhook --timeout=180s
}

build_and_import() {
  echo "==> Buildam $IMAGE"
  docker build -t "$IMAGE" "$ROOT"
  echo "==> Uvozim image u k3d"
  k3d image import "$IMAGE" -c "$CLUSTER"
}

deploy() {
  kubectl config use-context "k3d-$CLUSTER" >/dev/null
  ensure_secret_env
  echo "==> kubectl apply -k k8s/overlays/local"
  kubectl apply -k "$OVERLAY"
  # Tag 'local' se ne mijenja, pa Deployment sam ne bi primijetio novi image.
  kubectl -n "$NS" rollout restart deploy/moj-kompic
  kubectl -n "$NS" rollout status statefulset/postgres --timeout=180s
  kubectl -n "$NS" rollout status deploy/moj-kompic --timeout=180s
  echo
  echo "Gotovo -> https://$HOST"
  echo "(Upozorenje preglednika o certifikatu makneš s: ./scripts/k8s-local.sh trust-ca)"
}

case "${1:-}" in
  up)
    need docker "--cask docker"; need k3d k3d; need kubectl kubectl
    create_cluster; build_and_import; deploy ;;
  deploy)
    need docker "--cask docker"; need k3d k3d; need kubectl kubectl
    build_and_import; deploy ;;
  status)
    kubectl -n "$NS" get pods,svc,ingress,pvc,cronjob,certificate -o wide ;;
  logs)
    kubectl -n "$NS" logs -f deploy/moj-kompic ;;
  backup)
    job="backup-rucno-$(date +%s)"
    kubectl -n "$NS" create job --from=cronjob/postgres-backup "$job"
    kubectl -n "$NS" wait --for=condition=complete "job/$job" --timeout=120s
    kubectl -n "$NS" logs "job/$job" ;;
  trust-ca)
    tmp="$(mktemp)"
    kubectl -n "$NS" get secret moj-kompic-local-ca -o jsonpath='{.data.ca\.crt}' | base64 -d > "$tmp"
    echo "==> Dodajem 'Moj Kompic Local CA' u login Keychain (tražit će lozinku)"
    security add-trusted-cert -r trustRoot -k "$HOME/Library/Keychains/login.keychain-db" "$tmp"
    rm -f "$tmp"
    echo "Gotovo. Restartaj preglednik." ;;
  down)
    k3d cluster delete "$CLUSTER" ;;
  *)
    sed -n '2,12p' "$0"; exit 1 ;;
esac
