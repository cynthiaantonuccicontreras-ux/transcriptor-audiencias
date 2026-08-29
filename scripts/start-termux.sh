#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
PROJECT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
SERVER_PID=""
OPENER_PID=""
cleanup() {
  if [ -n "$OPENER_PID" ]; then kill "$OPENER_PID" 2>/dev/null || true; fi
  if [ -n "$SERVER_PID" ]; then kill "$SERVER_PID" 2>/dev/null || true; fi
  termux-wake-unlock 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
cd "$PROJECT_DIR"
if [ ! -d server/node_modules ] || [ ! -d node_modules ]; then
  echo "Primero ejecuta: bash scripts/setup-offline-termux.sh"
  exit 1
fi
(
  cd server
  node --input-type=module -e \
    "import 'dotenv/config'; import {assertLocalEngineAvailable} from './src/services/whisperService.js'; await assertLocalEngineAvailable();"
)
termux-wake-lock 2>/dev/null || true

echo "Iniciando transcripción gratuita en el teléfono..."
(
  cd "$PROJECT_DIR/server"
  export FFMPEG_PATH="$(command -v ffmpeg)" HOST=127.0.0.1 PORT=3000
  exec node src/index.js
) > "$PROJECT_DIR/server/termux-server.log" 2>&1 &
SERVER_PID=$!

READY=0
for attempt in $(seq 1 20); do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "El servicio no pudo iniciar:"
    tail -n 15 server/termux-server.log
    exit 1
  fi
  if curl --fail --silent --connect-timeout 2 --max-time 2 http://127.0.0.1:3000/health \
    | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);process.exit(j.ok&&j.engine==='whisper.cpp'?0:1)}catch{process.exit(1)}})"; then
    READY=1
    break
  fi
  sleep 0.5
done
if [ "$READY" != 1 ]; then
  echo "No respondió el servicio local. Envía una captura."
  exit 1
fi

echo "Servicio local listo. Necesitas Expo Go compatible con SDK 54."
echo "No cierres Termux. Los audios largos pueden tardar y calentar el teléfono."
(
  sleep 12
  termux-open-url 'exp://127.0.0.1:8081' 2>/dev/null || true
) &
OPENER_PID=$!
EXPO_PUBLIC_API_URL="http://127.0.0.1:3000" EXPO_NO_TELEMETRY=1 \
  EXPO_NO_TYPESCRIPT_SETUP=1 \
  node node_modules/expo/bin/cli start --offline --go --port 8081 --max-workers 2
