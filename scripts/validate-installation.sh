#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIRECTORY="${1:-/opt/hyborian-relay}"

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "Installation validation requires Linux." >&2
  exit 1
fi
for path in \
  "${INSTALL_DIRECTORY}/dist/main.js" \
  "${INSTALL_DIRECTORY}/dist/doctor.js" \
  "${INSTALL_DIRECTORY}/package.json" \
  "${INSTALL_DIRECTORY}/package-lock.json" \
  "${INSTALL_DIRECTORY}/.env" \
  "${INSTALL_DIRECTORY}/data"; do
  [[ -e "${path}" ]] || {
    echo "Missing installed path: ${path}" >&2
    exit 1
  }
done

node_major="$(node -p 'process.versions.node.split(".")[0]')"
if [[ "${node_major}" != "22" ]]; then
  echo "Node.js 22 is required; installed major version is ${node_major}." >&2
  exit 1
fi
if [[ "$(stat -c '%a' "${INSTALL_DIRECTORY}/.env")" != "600" ]]; then
  echo "Warning: ${INSTALL_DIRECTORY}/.env should have mode 600." >&2
fi

(cd "${INSTALL_DIRECTORY}" && node dist/doctor.js)
