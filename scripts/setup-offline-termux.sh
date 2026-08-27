#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
umask 077
PROJECT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
ENGINE_DIR="$PROJECT_DIR/local-runtime/whisper.cpp-1.8.2"
MODEL_DIR="$PROJECT_DIR/local-runtime/models"
MODEL_FILE="$MODEL_DIR/ggml-base-q5_1.bin"
ENGINE_COMMIT="4979e04f5dcaccb36057e059bbaed8a2f5288315"
MODEL_SHA1="a3733eda680ef76256db5fc5dd9de8629e62c5e7"
cd "$PROJECT_DIR"

if ! command -v pkg >/dev/null 2>&1; then
  echo "Este instalador es para Termux en Android. Consulta README para computador."
  exit 1
fi
echo "Preparando transcripción local gratuita. No se requiere clave ni tarjeta."
echo "Usa Wi-Fi para la descarga inicial. No cierres Termux."
pkg update -y
pkg install -y git nodejs-lts ffmpeg cmake clang make curl

echo "Preparando la interfaz y el servidor local..."
npm install --no-audit --no-fund
npm --prefix server install --omit=optional --no-audit --no-fund

mkdir -p "$MODEL_DIR"
if [ ! -d "$ENGINE_DIR" ]; then
  git clone --depth 1 --branch v1.8.2 --single-branch \
    https://github.com/ggml-org/whisper.cpp.git "$ENGINE_DIR"
fi
if [ "$(git -C "$ENGINE_DIR" rev-parse HEAD)" != "$ENGINE_COMMIT" ]; then
  echo "La versión local del motor no coincide. No se ha sobrescrito. Envía una captura."
  exit 1
fi
if [ ! -x "$ENGINE_DIR/build/bin/whisper-cli" ]; then
  echo "Compilando el motor para este teléfono; puede tardar varios minutos..."
  ARCH_OPTIONS=()
  case "$(uname -m)" in
    aarch64|arm64) ARCH_OPTIONS=(-DGGML_CPU_ARM_ARCH=armv8-a) ;;
  esac
  cmake -S "$ENGINE_DIR" -B "$ENGINE_DIR/build" \
    -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF \
    -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF \
    -DWHISPER_CURL=OFF -DGGML_NATIVE=OFF -DGGML_OPENMP=OFF \
    "${ARCH_OPTIONS[@]}"
  cmake --build "$ENGINE_DIR/build" --target whisper-cli --parallel 2
fi

if [ ! -f "$MODEL_FILE" ]; then
  echo "Descargando modelo multilingüe para español (aprox. 57 MiB)..."
  curl --fail --location --retry 3 --connect-timeout 30 --progress-bar \
    https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base-q5_1.bin \
    --output "$MODEL_FILE.part"
  if [ "$(sha1sum "$MODEL_FILE.part" | cut -d ' ' -f 1)" != "$MODEL_SHA1" ]; then
    echo "La descarga no pasó la comprobación. No se usará ese archivo. Envía una captura."
    exit 1
  fi
  mv "$MODEL_FILE.part" "$MODEL_FILE"
fi
if [ "$(sha1sum "$MODEL_FILE" | cut -d ' ' -f 1)" != "$MODEL_SHA1" ]; then
  echo "El modelo no coincide con el esperado. No se ha borrado ni sobrescrito."
  exit 1
fi

"$ENGINE_DIR/build/bin/whisper-cli" --help >/dev/null 2>&1
if [ ! -f server/.env ]; then cp server/.env.example server/.env; fi
echo
echo "Instalación gratuita terminada."
echo "No necesitas OpenAI API, clave ni tarjeta."
echo "Para abrir la app: bash scripts/start-termux.sh"
echo "Primero prueba un audio de 30 segundos. Aún falta verificar rendimiento en tu teléfono."
