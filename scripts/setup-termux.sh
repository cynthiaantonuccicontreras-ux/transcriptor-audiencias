#!/data/data/com.termux/files/usr/bin/bash
set -eu
PROJECT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
exec bash "$PROJECT_DIR/scripts/setup-offline-termux.sh"
