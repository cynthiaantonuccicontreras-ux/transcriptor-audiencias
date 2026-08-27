#!/data/data/com.termux/files/usr/bin/bash
set -eu

PROJECT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$PROJECT_DIR"

echo "Preparando Transcriptor de Audiencias para Android..."
pkg update -y
pkg install -y nodejs-lts ffmpeg nano

echo "Instalando la aplicación móvil..."
npm install --no-audit --no-fund

echo "Instalando el servidor local..."
npm --prefix server install --omit=optional --no-audit --no-fund

if [ ! -f .env ]; then
  cp .env.example .env
  sed -i 's#http://TU_IP_LOCAL:3000#http://127.0.0.1:3000#' .env
fi

if [ ! -f server/.env ]; then
  cp server/.env.example server/.env
fi

echo
echo "Instalación terminada."
echo "Ahora falta colocar tu clave de OpenAI en server/.env."
