#!/usr/bin/env bash
set -Eeuo pipefail

RUNTIME_DIR="/home/deploy/game-video-runtime"
RELEASE_ID="f11f9bd-zero-downtime"
RELEASE_DIR="${RUNTIME_DIR}/releases/${RELEASE_ID}/game-video-tool"
REPORT="${RUNTIME_DIR}/legacy-57991-wait-migration-$(date +%Y%m%d-%H%M%S).report"
LEGACY_OVERRIDE_DIR="/etc/systemd/system/game-video-tool.service.d"
LEGACY_OVERRIDE="${LEGACY_OVERRIDE_DIR}/zero-downtime-disable-restart.conf"

log() {
  printf '[%s] %s\n' "$(date -Is)" "$*"
}

wait_health() {
  local port="$1"
  local limit="${2:-60}"
  for _ in $(seq 1 "${limit}"); do
    if curl -fsS --max-time 2 "http://127.0.0.1:${port}/health" >/dev/null; then
      return 0
    fi
    sleep 1
  done
  return 1
}

rollback() {
  local exit_code=$?
  log "migration failed; restoring legacy restart behavior"
  systemctl stop game-video-tool@57991.service || true
  rm -f "${LEGACY_OVERRIDE}" || true
  rmdir "${LEGACY_OVERRIDE_DIR}" 2>/dev/null || true
  systemctl daemon-reload || true
  systemctl enable game-video-tool.service || true
  systemctl start game-video-tool.service || true
  wait_health 57991 60 || true
  log "FAILED exit_code=${exit_code}"
  exit "${exit_code}"
}
trap rollback ERR

if [ "$(id -u)" != "0" ]; then
  echo "FAILED: must run as root" >&2
  exit 1
fi
if [ ! -d "${RELEASE_DIR}" ]; then
  echo "FAILED: release dir missing: ${RELEASE_DIR}" >&2
  exit 1
fi

log "point 57991 slot to ${RELEASE_DIR}"
mkdir -p "${RUNTIME_DIR}/slots/57991"
tmp_link="${RUNTIME_DIR}/slots/57991/.current-${RELEASE_ID}.tmp"
rm -f "${tmp_link}"
ln -s "${RELEASE_DIR}" "${tmp_link}"
mv -Tf "${tmp_link}" "${RUNTIME_DIR}/slots/57991/current"
chown -h deploy:deploy "${RUNTIME_DIR}/slots/57991/current"

log "disable legacy restart loop"
mkdir -p "${LEGACY_OVERRIDE_DIR}"
cat > "${LEGACY_OVERRIDE}" <<'EOF'
[Service]
Restart=no
EOF
systemctl daemon-reload
systemctl disable game-video-tool.service || true
systemctl stop game-video-tool.service || true

log "wait for port 57991 to be released"
for _ in $(seq 1 30); do
  if ! ss -ltn "( sport = :57991 )" | grep -q ':57991'; then
    break
  fi
  sleep 1
done
if ss -ltn "( sport = :57991 )" | grep -q ':57991'; then
  echo "FAILED: port 57991 still occupied after disabling legacy restart" >&2
  exit 1
fi

log "start templated rollback service on 57991"
systemctl restart game-video-tool@57991.service
wait_health 57991 60
wait_health 57992 10
curl -fsS --max-time 10 http://106.53.49.23/health >/dev/null

log "enable templated services"
systemctl enable game-video-tool@57991.service game-video-tool@57992.service

{
  echo "SUCCESS"
  echo "release_dir=${RELEASE_DIR}"
  echo "active_port=$(cat "${RUNTIME_DIR}/active-port")"
  systemctl show game-video-tool.service game-video-tool@57991.service game-video-tool@57992.service -p ActiveState -p MainPID -p UnitFileState --no-pager
} > "${REPORT}" 2>&1
chown deploy:deploy "${REPORT}"
chmod 0644 "${REPORT}"
log "SUCCESS report=${REPORT}"
