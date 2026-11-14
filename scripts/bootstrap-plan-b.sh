#!/bin/bash
# Intended only for the separately approved Plan B private AL2023 app instances.
# No credentials in UserData, no package registry pull, no IAM changes.
set -euo pipefail
umask 077
[ "$(id -u)" = 0 ] || exit 1
[ "$#" = 6 ] || exit 1
bucket=$1; release_key=$2; release_sha=$3; config_key=$4; origin=$5; docker_version=$6
[[ "$release_sha" =~ ^[a-f0-9]{64}$ ]] || exit 1
[[ "$origin" =~ ^https://[a-z0-9]+\.cloudfront\.net$ ]] || exit 1
command -v aws >/dev/null
mkdir -p /opt/cloud-hub/release /etc/cloud-hub
chmod 700 /etc/cloud-hub
# Amazon AL2023 regional S3 repositories must be reachable through the endpoint.
# Exact RPM + AMI pins are deployment inputs; keep GPG verification enabled.
dnf -y --setopt=ip_resolve=4 install "docker-$docker_version"
systemctl enable --now docker
aws s3 cp "s3://$bucket/$release_key" /opt/cloud-hub/release.tgz --only-show-errors
printf '%s  %s\n' "$release_sha" /opt/cloud-hub/release.tgz | sha256sum -c -
# Artifact is a trusted, pre-reviewed release, not an arbitrary uploaded archive.
python3 - <<'PY'
import tarfile
from pathlib import PurePosixPath
with tarfile.open('/opt/cloud-hub/release.tgz') as archive:
 for member in archive:
  path=PurePosixPath(member.name)
  if path.is_absolute() or '..' in path.parts or not (member.isfile() or member.isdir()):
   raise SystemExit('Invalid release archive member')
PY
tar -xzf /opt/cloud-hub/release.tgz -C /opt/cloud-hub/release
cd /opt/cloud-hub/release
sha256sum -c cloud-hub-image.tar.sha256
docker load --input cloud-hub-image.tar
docker image inspect cloud-coordination-hub:release >/dev/null
aws s3 cp "s3://$bucket/$config_key" /etc/cloud-hub/runtime.json --only-show-errors
python3 - "$origin" <<'PY'
import json,sys,os
from urllib.parse import urlsplit,unquote
from pathlib import Path
config=json.loads(Path('/etc/cloud-hub/runtime.json').read_text())
url=config['postgresUrl']; parsed=urlsplit(url)
if parsed.scheme not in ['postgres','postgresql'] or not parsed.hostname or not parsed.username or parsed.query or parsed.fragment or unquote(parsed.username or '')!='cch_app':
 raise SystemExit('Restricted PostgreSQL app URL required')
ca=config['caPem']
if '-----BEGIN CERTIFICATE-----' not in ca: raise SystemExit('RDS CA certificate required')
values={'NODE_ENV':'production','DEPLOYMENT_MODE':'aws-multi','HOST':'0.0.0.0','PORT':'3000','APP_ORIGIN':sys.argv[1],'DATABASE_DRIVER':'postgres','POSTGRES_URL':url,'POSTGRES_SSL':'verify-full','POSTGRES_CA_FILE':'/run/cch/rds-ca.pem','POSTGRES_POOL_MAX':'5','ALLOW_AWS':'true'}
if any(any(c in value for c in ['\n','\r','\0']) for value in values.values()): raise SystemExit('Invalid runtime config')
Path('/etc/cloud-hub/app.env').write_text(''.join(key+'='+value+'\n' for key,value in values.items()))
os.chmod('/etc/cloud-hub/app.env',0o600)
Path('/etc/cloud-hub/rds-ca.pem').write_text(ca);os.chmod('/etc/cloud-hub/rds-ca.pem',0o644)
PY
cat > /opt/cloud-hub/run-plan-b.sh <<'SCRIPT'
#!/bin/bash
set -euo pipefail
exec /usr/bin/docker run --rm --name cloud-hub --network host --read-only --tmpfs /tmp:rw,noexec,nosuid,size=32m --cap-drop ALL --security-opt no-new-privileges --env-file /etc/cloud-hub/app.env --mount type=bind,source=/etc/cloud-hub/rds-ca.pem,target=/run/cch/rds-ca.pem,readonly --log-driver=local --log-opt max-size=10m --log-opt max-file=3 cloud-coordination-hub:release
SCRIPT
chmod 755 /opt/cloud-hub/run-plan-b.sh
cat > /etc/systemd/system/cloud-hub.service <<'UNIT'
[Unit]
Description=Cloud Coordination Hub Plan B PostgreSQL application
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target
[Service]
ExecStartPre=-/usr/bin/docker rm -f cloud-hub
ExecStart=/opt/cloud-hub/run-plan-b.sh
ExecStop=/usr/bin/docker stop --time 10 cloud-hub
Restart=always
RestartSec=10
TimeoutStopSec=20
[Install]
WantedBy=multi-user.target
UNIT
# Application failures are restarted by systemd. S3 logs avoid granting EC2 Logs access.
cat > /opt/cloud-hub/ship-logs.sh <<'SCRIPT'
#!/bin/bash
set -euo pipefail
umask 077
source /etc/cloud-hub/log-destination.env
mkdir -p /var/lib/cloud-hub-log-spool
stamp=$(date -u +%Y%m%dT%H%M%SZ)
file="/var/lib/cloud-hub-log-spool/$stamp.log"
# Cursor overlap favors duplicate diagnostic lines over silent loss after restart.
journalctl -u cloud-hub.service -n 10000 --since '6 minutes ago' --no-pager -o cat > "$file"
aws s3 cp "$file" "s3://$HUB_LOG_BUCKET/logs/$(hostname)/$stamp.log" --region "$HUB_REGION" --only-show-errors
find /var/lib/cloud-hub-log-spool -type f -name '*.log' -mmin +60 -delete
SCRIPT
printf 'HUB_LOG_BUCKET=%s\nHUB_REGION=%s\n' "$bucket" "${AWS_DEFAULT_REGION:?}" > /etc/cloud-hub/log-destination.env
chmod 755 /opt/cloud-hub/ship-logs.sh
cat > /etc/systemd/system/cloud-hub-log-upload.service <<'UNIT'
[Unit]
Description=Upload bounded application journal batches to private S3
[Service]
Type=oneshot
ExecStart=/opt/cloud-hub/ship-logs.sh
UNIT
cat > /etc/systemd/system/cloud-hub-log-upload.timer <<'UNIT'
[Unit]
Description=Upload application logs every five minutes
[Timer]
OnBootSec=5min
OnUnitActiveSec=5min
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now cloud-hub.service cloud-hub-log-upload.timer
