#!/usr/bin/env bash
set -euo pipefail

SERVICE_USER="hyborianrelay"
INSTALL_DIRECTORY="/opt/hyborian-relay"
UNIT_PATH="/etc/systemd/system/hyborian-relay.service"
PURGE=false

if [[ "${1:-}" == "--purge" ]]; then
  PURGE=true
elif [[ -n "${1:-}" ]]; then
  echo "Usage: $0 [--purge]" >&2
  exit 2
fi
if [[ "$(uname -s)" != "Linux" ]]; then
  echo "Hyborian Relay systemd removal requires Linux." >&2
  exit 1
fi
if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this uninstaller as root with sudo." >&2
  exit 1
fi

systemctl disable --now hyborian-relay.service 2>/dev/null || true
rm -f "${UNIT_PATH}"
systemctl daemon-reload

if [[ "${PURGE}" == true ]]; then
  read -r -p "Delete ${INSTALL_DIRECTORY}, including .env and database files? Type PURGE: " confirmation
  if [[ "${confirmation}" != "PURGE" ]]; then
    echo "Purge cancelled; configuration and data were preserved."
    exit 1
  fi
  rm -rf "${INSTALL_DIRECTORY}"
  if command -v userdel >/dev/null && id "${SERVICE_USER}" >/dev/null 2>&1; then
    userdel "${SERVICE_USER}"
  fi
  echo "Hyborian Relay, its configuration, and its data were removed."
else
  rm -rf "${INSTALL_DIRECTORY}/dist" "${INSTALL_DIRECTORY}/node_modules"
  rm -f \
    "${INSTALL_DIRECTORY}/package.json" \
    "${INSTALL_DIRECTORY}/package-lock.json" \
    "${INSTALL_DIRECTORY}/.env.example"
  echo "Hyborian Relay code was removed. ${INSTALL_DIRECTORY}/.env and data were preserved."
fi
