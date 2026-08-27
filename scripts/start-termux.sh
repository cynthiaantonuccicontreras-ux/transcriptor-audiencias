#!/data/data/com.termux/files/usr/bin/bash
set -eu

PROJECT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
SERVER_PID=""

cleanup() {
  if [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" 2>/dev/null || true
  fi
  termux-wake-unlock 2>/dev/null || true
}

trap cleanup EXIT INT TERM
cd "$PROJECT_DIR"

if [ ! -f server/.env ]; then
  echo "Falta server/.env. Ejecuta primero: bash scripts/setup-termux.sh"
  exit 1
fi

if grep -q 'sk-reemplaza-esta-linea' server/.env; then
  echo "Falta escribir tu clave de OpenAI en server/.env."
  echo "Abre el archivo con: nano server/.env"
  exit 1
fi

termux-wake-lock 2>/dev/null || true

echo "Iniciando servidor de transcripción..."
(
  cd "$PROJECT_DIR/server"
  FFMPEG_PATH="$(command -v ffmpeg)" node src/index.js
) > "$PROJECT_DIR/server/termux-server.log" 2>&1 &
SERVER_PID=$!

sleep 3
if ! kill -0 "$SERVER_PID" 2>/dev/null; then
  echo "El servidor no pudo iniciar:"
  tail -n 20 "$PROJECT_DIR/server/termux-server.log"
  exit 1
fi

echo "Servidor listo. Abriendo Expo Go..."
(sleep 12; termux-open-url 'exp://127.0.0.1:8081' 2>/dev/null || true) &

EXPO_PUBLIC_API_URL="http://127.0.0.1:3000" \
  npx expo start --localhost --clear
