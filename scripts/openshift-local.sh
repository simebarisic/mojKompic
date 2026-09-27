#!/usr/bin/env bash
# Moj Kompić na OpenShift Local (CRC). Isti k8s/base kao k3d, razlike su u openshift/.
#
#   ./scripts/openshift-local.sh up          pokrene CRC (ako treba), kreira project, build + deploy
#   ./scripts/openshift-local.sh deploy      novi build iz trenutnog koda (Deployment se sam rolla)
#   ./scripts/openshift-local.sh apply       samo primijeni manifeste (bez builda)
#   ./scripts/openshift-local.sh status      podovi, route, buildovi, imagestream, PVC-ovi
#   ./scripts/openshift-local.sh logs        logovi aplikacije
#   ./scripts/openshift-local.sh build-logs  log zadnjeg builda
#   ./scripts/openshift-local.sh backup      ručni backup baze (Job iz CronJoba)
#   ./scripts/openshift-local.sh console     otvori OpenShift web konzolu
#   ./scripts/openshift-local.sh down        obriše cijeli project (i podatke u njemu!)
#
# Treba: OpenShift Local (crc) s pull secretom. CRC i k3d zajedno pojedu
# previše RAM-a - prije "up" ugasi k3d klastere (k3d cluster stop --all).
set -euo pipefail

PROJECT=moj-kompic
APP=moj-kompic
HOST=kompic.apps-crc.testing
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OVERLAY="$ROOT/openshift"

ensure_crc() {
  command -v crc >/dev/null || { echo "Nedostaje 'crc' (OpenShift Local)." >&2; exit 1; }
  if ! crc status 2>/dev/null | grep -q "OpenShift:.*Running"; then
    echo "==> Pokrećem CRC (prvi put traje ~5-10 min)"
    crc start
  fi
  # oc CLI dolazi s CRC-om
  eval "$(crc oc-env)"
}

login() {
  if [ "$(oc whoami 2>/dev/null || true)" != "developer" ]; then
    echo "==> oc login kao 'developer'"
    oc login -u developer -p developer https://api.crc.testing:6443 --insecure-skip-tls-verify=true >/dev/null
  fi
  if ! oc get project "$PROJECT" >/dev/null 2>&1; then
    echo "==> oc new-project $PROJECT"
    oc new-project "$PROJECT" >/dev/null
  fi
  oc project "$PROJECT" >/dev/null
}

ensure_secret_env() {
  if [ ! -f "$OVERLAY/secret.env" ]; then
    echo "==> Kreiram openshift/secret.env s nasumičnim lozinkama"
    cat > "$OVERLAY/secret.env" <<ENV
POSTGRES_PASSWORD=$(openssl rand -hex 24)
AUTH_PASSWORD_HASH=
SESSION_SECRET=$(openssl rand -hex 32)
ENV
  fi
}

apply() {
  ensure_secret_env
  echo "==> oc apply -k openshift/"
  oc apply -k "$OVERLAY"
}

build() {
  # Šaljemo samo ono što git ne ignorira (bez node_modules, .env, *.local.*),
  # uključujući još necommitane izmjene.
  local tmp
  tmp="$(mktemp -t moj-kompic-build).tar.gz"
  (cd "$ROOT" && git ls-files -z -co --exclude-standard | tar --null -czf "$tmp" -T -)
  echo "==> oc start-build $APP ($(du -h "$tmp" | cut -f1) izvornog koda)"
  oc start-build "$APP" --from-archive="$tmp" --follow --wait
  rm -f "$tmp"
}

wait_ready() {
  oc rollout status statefulset/postgres --timeout=300s
  oc rollout status "deploy/$APP" --timeout=300s
  echo
  echo "Gotovo -> https://$HOST"
  echo "(preglednik će upozoriti na certifikat OpenShift routera - vidi openshift/README.md)"
}

case "${1:-}" in
  up)         ensure_crc; login; apply; build; wait_ready ;;
  deploy)     ensure_crc; login; build; wait_ready ;;
  apply)      ensure_crc; login; apply ;;
  status)     ensure_crc; login; oc get pods,svc,route,is,bc,builds,pvc,cronjob ;;
  logs)       ensure_crc; login; oc logs -f "deploy/$APP" ;;
  build-logs) ensure_crc; login; oc logs -f "bc/$APP" ;;
  backup)
    ensure_crc; login
    job="backup-rucno-$(date +%s)"
    oc create job --from=cronjob/postgres-backup "$job"
    oc wait --for=condition=complete "job/$job" --timeout=180s
    oc logs "job/$job" ;;
  console)    ensure_crc; crc console ;;
  down)       ensure_crc; login; oc delete project "$PROJECT" ;;
  *)          sed -n '2,15p' "$0"; exit 1 ;;
esac
