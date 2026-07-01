#!/usr/bin/env bash
set -Eeuo pipefail

RUNTIME_DIR="/home/deploy/game-video-runtime"
RELEASE_ID="f11f9bd-zero-downtime"
RELEASE_DIR="${RUNTIME_DIR}/releases/${RELEASE_ID}/game-video-tool"
REPORT="${RUNTIME_DIR}/legacy-57991-mask-migration-$(date +%Y%m%d-%H%M%S).report"

log() {
  printf '[%s] %s\n' "$(date -Is)" "$*"
}

rollback() {
  local exit_code=$?
  log "migration failed; unmasking legacy service"
  systemctl stop game-video-tool@57991.service || true
  systemctl unmask game-video-tool.service || true
  systemctl enable game-video-tool.service || true
  systemctl start game-video-tool.service || true
  curl -fsS --max-time 10 http://127.0.0.1:57991/health >/dev/null || true
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

log "mask and stop legacy restart-always service"
systemctl disable game-video-tool.service || true
systemctl mask game-video-tool.service
systemctl stop game-video-tool.service || true

for _ in $(seq 1 20); do
  if ! ss -ltn "( sport = :57991 )" | grep -q ':57991'; then
    break
  fi
  sleep 0.5
done
if ss -ltn "( sport = :57991 )" | grep -q ':57991'; then
  echo "FAILED: port 57991 still occupied after masking legacy service" >&2
  exit 1
fi

log "start templated rollback service on 57991"
systemctl restart game-video-tool@57991.service
curl -fsS --max-time 10 http://127.0.0.1:57991/health >/dev/null
curl -fsS --max-time 10 http://127.0.0.1:57992/health >/dev/null
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
