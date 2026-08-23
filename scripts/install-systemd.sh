#!/usr/bin/env bash
set -euo pipefail

SERVICE_USER="hyborianrelay"
INSTALL_DIRECTORY="/opt/hyborian-relay"
UNIT_PATH="/etc/systemd/system/hyborian-relay.service"
SOURCE_DIRECTORY="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "Hyborian Relay systemd installation requires Linux." >&2
  exit 1
fi
if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this installer as root with sudo." >&2
  exit 1
fi
for command in install node npm systemctl useradd id cp rm; do
  command -v "${command}" >/dev/null || {
    echo "Required command is missing: ${command}" >&2
    exit 1
  }
done
for required_path in package.json package-lock.json dist/main.js packaging/hyborian-relay.service; do
  [[ -e "${SOURCE_DIRECTORY}/${required_path}" ]] || {
    echo "Required build artifact is missing: ${required_path}. Run npm ci and npm run build first." >&2
    exit 1
  }
done

if ! id "${SERVICE_USER}" >/dev/null 2>&1; then
  useradd --system --home-dir "${INSTALL_DIRECTORY}" --shell /usr/sbin/nologin "${SERVICE_USER}"
fi

systemctl stop hyborian-relay.service 2>/dev/null || true
install -d -m 0750 -o "${SERVICE_USER}" -g "${SERVICE_USER}" "${INSTALL_DIRECTORY}"
install -d -m 0700 -o "${SERVICE_USER}" -g "${SERVICE_USER}" "${INSTALL_DIRECTORY}/data"
rm -rf "${INSTALL_DIRECTORY}/dist" "${INSTALL_DIRECTORY}/node_modules"
cp -R "${SOURCE_DIRECTORY}/dist" "${INSTALL_DIRECTORY}/dist"
install -m 0644 "${SOURCE_DIRECTORY}/package.json" "${INSTALL_DIRECTORY}/package.json"
install -m 0644 "${SOURCE_DIRECTORY}/package-lock.json" "${INSTALL_DIRECTORY}/package-lock.json"
install -m 0644 "${SOURCE_DIRECTORY}/.env.example" "${INSTALL_DIRECTORY}/.env.example"

if [[ ! -e "${INSTALL_DIRECTORY}/.env" ]]; then
  install -m 0600 -o "${SERVICE_USER}" -g "${SERVICE_USER}" \
    "${SOURCE_DIRECTORY}/.env.example" "${INSTALL_DIRECTORY}/.env"
  echo "Created ${INSTALL_DIRECTORY}/.env. Configure it before starting the service."
else
  chmod 0600 "${INSTALL_DIRECTORY}/.env"
fi

(cd "${INSTALL_DIRECTORY}" && npm ci --omit=dev --ignore-scripts=false)
chown -R "${SERVICE_USER}:${SERVICE_USER}" "${INSTALL_DIRECTORY}"
chmod 0700 "${INSTALL_DIRECTORY}/data"
install -m 0644 "${SOURCE_DIRECTORY}/packaging/hyborian-relay.service" "${UNIT_PATH}"
systemctl daemon-reload

echo "Hyborian Relay is installed."
echo "After configuring ${INSTALL_DIRECTORY}/.env, run:"
echo "  sudo systemctl enable --now hyborian-relay"
