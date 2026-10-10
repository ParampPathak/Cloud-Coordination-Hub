#!/bin/bash
# Run only later on an approved x86_64 Linux image builder with Docker already installed.
# This installer downloads nothing and does not call AWS.
set -euo pipefail
test "$(id -u)" = 0 || { echo 'Run as root on the approved image builder.'; exit 1; }
command -v docker >/dev/null
cd "$(dirname "$0")"
sha256sum -c cloud-hub-image.tar.sha256
docker load --input cloud-hub-image.tar
docker image inspect cloud-coordination-hub:release >/dev/null
mkdir -p /opt/cloud-hub
cat > /opt/cloud-hub/run.sh <<'SCRIPT'
#!/bin/bash
set -euo pipefail
source /etc/cloud-hub-logging.env
args=(--log-driver=local --log-opt max-size=10m --log-opt max-file=3)
if [ "$HUB_CLOUD_LOGS" = true ]; then
  args=(--log-driver=awslogs --log-opt "awslogs-region=$HUB_REGION" --log-opt "awslogs-group=$HUB_LOG_GROUP" --log-opt "awslogs-stream=$(hostname)" --log-opt awslogs-create-group=false)
fi
exec /usr/bin/docker run --rm --name cloud-hub --network host --read-only --tmpfs /tmp:rw,noexec,nosuid,size=32m --cap-drop ALL --security-opt no-new-privileges --env-file /etc/cloud-hub.env "${args[@]}" cloud-coordination-hub:release
SCRIPT
chmod 755 /opt/cloud-hub/run.sh
cat > /etc/systemd/system/cloud-hub.service <<'UNIT'
[Unit]
Description=Cloud Coordination Hub preloaded application
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target
ConditionPathExists=/etc/cloud-hub.env
[Service]
ExecStartPre=-/usr/bin/docker rm -f cloud-hub
ExecStart=/opt/cloud-hub/run.sh
ExecStop=/usr/bin/docker stop --time 10 cloud-hub
Restart=on-failure
RestartSec=10
TimeoutStopSec=20
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
# Do not enable/start while baking; launch-template UserData supplies runtime configuration.
echo 'Installed offline runtime. Stop the image builder before creating the release AMI; do not bake credentials, databases, users, or runtime config.'
