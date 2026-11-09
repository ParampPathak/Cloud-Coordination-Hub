#!/usr/bin/env bash
# Run manually on Ubuntu only: sudo bash scripts/deploy-ec2.sh
set -Eeuo pipefail
umask 027
[[ $EUID -eq 0 ]] || { echo 'Run with sudo on Ubuntu.' >&2; exit 1; }
source /etc/os-release
[[ $ID == ubuntu ]] || { echo 'This script requires Ubuntu.' >&2; exit 1; }
ROOT=/opt/cloud-coordination-hub
DATA=/var/lib/cloud-coordination-hub
ENV_FILE=/etc/cloud-coordination-hub.env
SERVICE=cloud-coordination-hub
SOURCE=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
[[ -f $ENV_FILE ]] || { echo "Create $ENV_FILE from deployment/ec2.env.example first." >&2; exit 1; }
apt-get update
apt-get install -y ca-certificates curl git xz-utils sqlite3 util-linux
install -d -m 0755 "$ROOT/releases"
# Serialize deployments so two SSH sessions cannot replace current concurrently.
exec 9>"$ROOT/deploy.lock"
flock -n 9 || { echo 'Another deployment is running.' >&2; exit 1; }
if [[ ! -x $ROOT/node/bin/node ]]; then
  case $(uname -m) in x86_64) arch=x64;; aarch64) arch=arm64;; *) echo 'Unsupported CPU.' >&2; exit 1;; esac
  download=$(mktemp -d)
  # Official Node 24 binaries; checksum downloaded over HTTPS from the same release.
  curl -fsSL https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt -o "$download/SHASUMS256.txt"
  archive=$(awk -v suffix="-linux-$arch.tar.xz" '$2 ~ suffix "$" {print $2}' "$download/SHASUMS256.txt")
  [[ $archive =~ ^node-v24\.[0-9]+\.[0-9]+-linux-(x64|arm64)\.tar\.xz$ ]] || exit 1
  version=${archive#node-}; version=${version%-linux-*}
  curl -fsSL "https://nodejs.org/dist/$version/$archive" -o "$download/$archive"
  (cd "$download" && awk -v file="$archive" '$2 == file' SHASUMS256.txt | sha256sum -c -)
  install -d -m 0755 "$ROOT/node"
  tar -xJf "$download/$archive" -C "$ROOT/node" --strip-components=1
  rm -rf -- "$download"
fi
export PATH="$ROOT/node/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
[[ $(node -p 'process.versions.node.split(".")[0]') == 24 ]] || { echo 'Node 24 required.' >&2; exit 1; }
id hub >/dev/null 2>&1 || useradd --system --user-group --home-dir "$DATA" --shell /usr/sbin/nologin hub
install -d -o hub -g hub -m 0700 "$DATA"
chown root:hub "$ENV_FILE"
chmod 0640 "$ENV_FILE"
release="$ROOT/releases/$(date -u +%Y%m%dT%H%M%SZ)-$$"
install -d -o hub -g hub -m 0755 "$release"
# Snapshot tracked and nonignored files, with explicit secret/data exclusions.
# Never copy node_modules or runtime data into a release; never git pull as root.
(cd "$SOURCE" && git ls-files --cached --others --exclude-standard -z | \
  tar --null --verbatim-files-from --exclude='.env' --exclude='.env.*' \
      --exclude='*.sqlite*' --exclude='*.db*' --exclude='*.pem' --exclude='*.key' \
      --exclude='data/*' -T - -cf -) | tar -xf - -C "$release"
chown -R hub:hub "$release"
runuser -u hub -- bash -c 'set -e; cd "$1"; npm ci --include=dev --no-audit --no-fund; npm run build; npm test; npm prune --omit=dev --no-audit --no-fund' bash "$release"
# Validate with the same config loader as the server, before stopping the old app.
db=$(runuser -u hub -- bash -c 'cd "$1"; node --env-file="$2" --input-type=module -e '\''import {readConfig} from "./dist/backend/backend/src/config.js"; const c=readConfig(); if(c.NODE_ENV!=="production" || c.DATABASE_DRIVER!=="sqlite" || c.ALLOW_AWS!=="false" || c.HOST!=="127.0.0.1" || !c.SQLITE_PATH.startsWith("/var/lib/cloud-coordination-hub/") || c.APP_ORIGIN.toUpperCase().includes("REPLACE")) throw Error("Configure production SQLite, loopback HOST, data path and APP_ORIGIN first."); console.log(c.SQLITE_PATH);'\''' bash "$release" "$ENV_FILE")
port=$(runuser -u hub -- bash -c 'cd "$1"; node --env-file="$2" --input-type=module -e '\''import {readConfig} from "./dist/backend/backend/src/config.js"; console.log(readConfig().PORT);'\''' bash "$release" "$ENV_FILE")
chown -R root:root "$release"
chmod -R a+rX,go-w "$release"
previous=''
if [[ -L $ROOT/current ]]; then previous=$(readlink -f "$ROOT/current" || true); fi
rollback() {
  systemctl stop "$SERVICE" || true
  if [[ -n $previous && $previous != "$ROOT/current" && -d $previous ]]; then
    ln -sfn "$previous" "$ROOT/current.rollback"
    mv -Tf "$ROOT/current.rollback" "$ROOT/current"
    systemctl reset-failed "$SERVICE" || true
    systemctl restart "$SERVICE" || true
  fi
  echo 'Deployment failed. Previous release restored when available; database was not replaced. Inspect journalctl.' >&2
}
trap rollback ERR
if systemctl cat "$SERVICE" >/dev/null 2>&1; then systemctl stop "$SERVICE"; fi
if [[ -f $db ]]; then
  install -d -m 0700 "$ROOT/backups"
  sqlite3 "$db" ".backup '$ROOT/backups/$(date -u +%Y%m%dT%H%M%SZ)-$$.sqlite'"
fi
install -m 0644 "$release/deployment/cloud-coordination-hub.service" "/etc/systemd/system/$SERVICE.service"
ln -sfn "$release" "$ROOT/current.next"
mv -Tf "$ROOT/current.next" "$ROOT/current"
systemctl daemon-reload
systemctl enable "$SERVICE"
systemctl reset-failed "$SERVICE"
systemctl restart "$SERVICE"
ready=false
for _ in {1..30}; do
  if systemctl is-active --quiet "$SERVICE" && curl --max-time 2 -fsS "http://127.0.0.1:$port/api/ready" >/dev/null; then ready=true; break; fi
  sleep 1
done
[[ $ready == true ]]
trap - ERR
echo "Deployment healthy: $release. SQLite preserved at $db. Configure Nginx separately."
