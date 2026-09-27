# Moj Kompić na OpenShift Local (CRC)

Pilot: isti `k8s/base` koji vrti k3d, ali deployan na OpenShift. Sve razlike
su u ovom direktoriju (`kustomization.yaml` ih komentira jednu po jednu).

```bash
k3d cluster stop --all              # CRC + k3d zajedno pojedu previše RAM-a
./scripts/openshift-local.sh up     # CRC start, project, build u klasteru, deploy
open https://kompic.apps-crc.testing
./scripts/openshift-local.sh console   # web konzola (developer / developer)
```

Nakon promjene koda: `./scripts/openshift-local.sh deploy` - novi build, a
Deployment se sam rolla na novi image (image trigger).

## Kubernetes (k3d) vs OpenShift - što se promijenilo i zašto

| | k3d (`k8s/overlays/local`) | OpenShift (`openshift/`) |
|---|---|---|
| CLI | `kubectl` | `oc` (nadskup kubectla: `oc get`, `oc apply -k`... + `oc new-project`, `oc start-build`) |
| Namespace | `Namespace` objekt u manifestima | **Project** preko `oc new-project` (developer ne smije kreirati Namespace) |
| Ulaz izvana | Ingress + Traefik | **Route** (`route.yaml`), OpenShift router |
| TLS | cert-manager + vlastiti CA | router radi TLS (edge) sa svojim `*.apps-crc.testing` certifikatom |
| Image | `docker build` na Macu + `k3d image import` | **BuildConfig** builda iz Dockerfilea *u klasteru*, rezultat u **ImageStream** |
| Rollout na novi image | `kubectl rollout restart` | **image trigger** anotacija - automatski |
| Sigurnost podova | naš `securityContext` (fiksni uid 1000/70) | **SCC restricted-v2**: OpenShift sam dodijeli nasumični UID; fiksni UID se briše |
| Postgres | `postgres:16-alpine` | `quay.io/sclorg/postgresql-16-c9s` - službeni image traži root pri startu |

Najvažnija lekcija je SCC: u OpenShiftu kontejner **ne zna unaprijed svoj UID**
(dobije npr. 1000650000, grupa 0). Image mora raditi s bilo kojim UID-om:
fajlovi čitljivi svima / grupi 0, bez pisanja po `/app`, port > 1024.
Moj Kompić to već zadovoljava (Dockerfile `--chown` + `USER node`, port 3001).

## Korisne naredbe

```bash
eval $(crc oc-env)                         # oc u PATH (skripta to radi sama)
oc get pods,route,is,bc,builds
oc logs -f bc/moj-kompic                   # log builda
oc describe pod -l app.kubernetes.io/name=moj-kompic
oc get pod <ime> -o jsonpath='{.spec.securityContext}'     # vidi dodijeljeni UID/fsGroup
oc get pod <ime> -o jsonpath='{.metadata.annotations.openshift\.io/scc}'  # koji SCC je primijenjen
oc rsh statefulset/postgres psql -U kompic kompic
```

## Upozorenje o certifikatu

Router koristi certifikat potpisan internim CA-om CRC klastera. Za učenje je
najjednostavnije kliknuti "Proceed". Ako želiš da mu Mac vjeruje:

```bash
eval $(crc oc-env)
oc login -u kubeadmin https://api.crc.testing:6443    # lozinka: crc console --credentials
oc extract secret/router-ca -n openshift-ingress-operator --keys=tls.crt --to=- > /tmp/crc-router-ca.crt
security add-trusted-cert -r trustRoot -k ~/Library/Keychains/login.keychain-db /tmp/crc-router-ca.crt
oc login -u developer -p developer https://api.crc.testing:6443
```

(CRC generira novi CA kad ga obrišeš s `crc delete`, pa bi to trebalo ponoviti.)

## Resursi

OpenShift Local traži puno više od k3d-a: zadano 4 CPU, ~10.5 GB RAM, ~35 GB diska.
Ako je spor: `crc config set memory 12288 && crc stop && crc start`.
Gašenje: `crc stop` (podaci ostaju). Čišćenje projekta: `./scripts/openshift-local.sh down`.
