# Transcriptor de Audiencias — local y sin API de pago

Aplicación Android con React Native, Expo y Node.js. Graba o abre audios largos,
muestra progreso por fragmento y entrega el texto con buscador y copia al portapapeles.

**Esta versión no usa la API de OpenAI, no requiere una clave, tarjeta ni suscripción
y no cobra por minuto.** Ejecuta el motor abierto [whisper.cpp](https://github.com/ggml-org/whisper.cpp)
en el mismo teléfono mediante Termux. Instalar la aplicación y descargar el modelo
sí requiere internet y puede consumir datos de tu plan.

## Qué cambia y qué limitaciones tiene

- La interfaz sigue siendo React Native/Expo; el motor se ejecuta dentro de Termux.
  No es todavía un APK independiente: deben permanecer abiertos Termux y Expo Go.
- Modelo inicial: `base-q5_1` multilingüe (incluye español), unos 57 MiB. Se verifica
  la descarga usando el SHA publicado por el [distribuidor del modelo](https://huggingface.co/ggerganov/whisper.cpp).
- No usa servidores de transcripción externos ni tiene un fallback de pago.
- Un modelo pequeño puede equivocarse más que un modelo grande. Revisa nombres,
  cifras, fechas y términos jurídicos contra el audio. No es una transcripción certificada.
- La velocidad depende del teléfono. Un audio de una hora podría tardar más de una
  hora; no se ha medido todavía en el teléfono de la usuaria. Consume batería y puede
  calentar el dispositivo. Prueba primero 30 segundos, después 5 minutos.
- Se necesita espacio para el archivo original, la copia de carga y fragmentos WAV:
  estos últimos suman aproximadamente 115 MB por hora. Reserva además espacio para
  paquetes, compilación y modelo; se recomiendan varios GB libres.
- Los trabajos y resultados permanecen en memoria, hasta 24 horas tras terminar.
  Cerrar el servidor o un cierre forzado de Android pierde ese estado; no hay
  reanudación después de reiniciar. Copia el resultado antes de salir.
- Los archivos temporales de cada trabajo se borran al terminar o fallar. Un cierre
  brusco puede dejar temporales; no se borran los audios originales del teléfono.
- La grabación en segundo plano/pantalla bloqueada no está garantizada en Expo Go.

## Actualizar una instalación existente desde Android

Si ya ejecutaste el instalador anterior en `transcriptor-audiencias-app`, pega esto
en Termux:

```bash
cd "$HOME/transcriptor-audiencias-app" && git pull --ff-only && bash scripts/setup-offline-termux.sh
```

No hace falta reinstalar Termux, borrar archivos ni introducir una clave. Si existe
un antiguo `server/.env` con `OPENAI_API_KEY`, la nueva versión **no la lee para
transcribir**. No publiques ese archivo; sigue excluido de GitHub.

El instalador prepara las dependencias, compila whisper.cpp v1.8.2 (commit fijado),
descarga el modelo multilingüe y comprueba su integridad. No cambia permisos de
seguridad del teléfono. Puede ejecutarse de nuevo si una descarga se interrumpe.

Al terminar debe decir **Instalación gratuita terminada**.

## Instalación nueva, sólo desde Android

1. Instala [Termux desde una fuente oficial](https://github.com/termux/termux-app#installation).
   Existe una versión oficial en Google Play y otra en F-Droid/GitHub; no mezcles
   instalaciones ni complementos de distintos orígenes. La variante Google Play
   tiene diferencias de compatibilidad.
2. Abre Termux y ejecuta:

```bash
cd "$HOME"
pkg update -y && pkg install -y git
git clone https://github.com/cynthiaantonuccicontreras-ux/transcriptor-audiencias.git transcriptor-audiencias-app
cd transcriptor-audiencias-app
bash scripts/setup-termux.sh
```

3. Usa [Expo Go compatible con SDK 54](https://expo.dev/go?sdkVersion=54&platform=android&device=true).
   El proyecto conserva SDK 54. Actualizar Expo Go a una versión incompatible **no**
   actualiza este proyecto. La instalación de un APK requiere una confirmación
   manual de Android; no desactives Play Protect para resolver una advertencia.
4. Inicia la aplicación:

```bash
cd "$HOME/transcriptor-audiencias-app"
bash scripts/start-termux.sh
```

El script comprueba el motor, inicia el servicio exclusivamente en
`127.0.0.1:3000`, inicia Expo en modo local/sin internet y trata de abrir
`exp://127.0.0.1:8081`. No necesitas escanear un QR desde otro equipo.
Si no se abre automáticamente, introduce esa dirección en Expo Go.

Deja Termux abierto; vuelve a Expo Go para grabar o seleccionar el audio.
La pantalla se mantiene activa durante grabación y transcripción. Para parar el
servicio, vuelve a Termux y usa Ctrl+C. Esto también detiene trabajos pendientes.

## Cómo funciona el audio largo

1. Expo envía el archivo únicamente al servicio del propio teléfono.
2. FFmpeg convierte en disco a WAV PCM, mono, 16 kHz, 16 bits y segmentos de dos
   minutos (unos 3,84 MB cada uno). No se carga el archivo completo en RAM.
3. Node ejecuta `whisper-cli` sin shell, con idioma español y dos hilos.
4. Se procesa un solo trabajo y un solo fragmento a la vez, conservando el orden.
   Se admiten como máximo dos trabajos pendientes, contando las cargas.
5. El progreso procede de los porcentajes reales del motor y de la parte actual.
   No es una predicción exacta del tiempo restante.
6. Se unen los textos en orden y se eliminan las copias temporales.

Ya no aplica el límite de 25 MB de la API: no se llama a esa API. Aun así, cada
fragmento se valida por debajo de 24 MB para limitar consumo y conservar margen.
Los cortes son temporales; una palabra que cruce un corte puede necesitar revisión.
No hay identificación automática de hablantes.

## Configuración opcional

El instalador funciona sin editar archivos. Se pueden cambiar estas opciones en
`server/.env` (rutas absolutas para binario/modelo):

```dotenv
HOST=127.0.0.1
PORT=3000
TRANSCRIPTION_LANGUAGE=es
LOCAL_CHUNK_SECONDS=120
WHISPER_THREADS=2
WHISPER_CHUNK_TIMEOUT_MS=3600000
MAX_CHUNK_BYTES=24000000
MAX_UPLOAD_BYTES=2000000000
# WHISPER_CPP_BIN=/ruta/al/whisper-cli
# WHISPER_MODEL_PATH=/ruta/al/modelo-multilingue.bin
```

El límite de tiempo es por fragmento. Un fallo detiene el trabajo sin presentar
texto incompleto como completo. No se hacen reintentos hacia un servicio de pago.
Más hilos no garantizan más velocidad y pueden aumentar temperatura/consumo.

La variable de la interfaz `EXPO_PUBLIC_API_URL` apunta al servicio local, por
defecto `http://127.0.0.1:3000`. No almacenes secretos en variables `EXPO_PUBLIC_`.

## Clonar y desarrollar en computador (opcional)

En Linux o macOS, instala Git, Node.js 20.19 o posterior, FFmpeg, CMake y un
compilador C/C++. Después:

```bash
git clone https://github.com/cynthiaantonuccicontreras-ux/transcriptor-audiencias.git
cd transcriptor-audiencias
npm install
npm --prefix server install --omit=optional
mkdir -p local-runtime
git clone --depth 1 --branch v1.8.2 https://github.com/ggml-org/whisper.cpp.git local-runtime/whisper.cpp-1.8.2
cmake -S local-runtime/whisper.cpp-1.8.2 -B local-runtime/whisper.cpp-1.8.2/build -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF -DWHISPER_CURL=OFF
cmake --build local-runtime/whisper.cpp-1.8.2/build --target whisper-cli --parallel 2
mkdir -p local-runtime/models
curl --fail --location https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base-q5_1.bin --output local-runtime/models/ggml-base-q5_1.bin
```

Comprueba que el SHA-1 del modelo sea
`a3733eda680ef76256db5fc5dd9de8629e62c5e7` con `sha1sum` (Linux) o `shasum`
(macOS). En una terminal:

```bash
cd server
HOST=0.0.0.0 npm start
```

En otra, desde la raíz, reemplaza la IP por la del computador en tu Wi-Fi:

```bash
EXPO_PUBLIC_API_URL=http://192.168.1.25:3000 npx expo start --lan
```

Abre Expo Go SDK 54 en Android, en la misma Wi-Fi, y escanea el QR. Este modo envía
el audio al computador local, no a la nube. Sólo usa una red privada de confianza:
el servidor no tiene autenticación ni HTTPS y **no debe exponerse a internet**.
El modo Termux no usa `HOST=0.0.0.0`.

## Comprobaciones

Pruebas automáticas sin API ni clave:

```bash
npm --prefix server run check
npm --prefix server test
bash -n scripts/setup-termux.sh scripts/setup-offline-termux.sh scripts/start-termux.sh
npx expo export --platform android
```

Se prueba configuración, orden, fallos, progreso partido entre eventos, cola,
límite de tiempo y fragmentación con FFmpeg real. Para la prueba opcional del
motor completo hace falta tener el binario compilado y el modelo descargado:

```bash
cd server
RUN_WHISPER_INTEGRATION=1 RUN_LONG_AUDIO_TEST=1 npm test
```

La integración usa el audio público de muestra de whisper.cpp y no una API.
La prueba larga genera más de una hora de silencio y valida **la fragmentación**;
no demuestra por sí sola la precisión o velocidad de transcripción.

Validación manual pendiente en Android: permisos de micrófono, abrir archivo,
transcripción corta en español, copia/búsqueda, y luego un audio de más de una hora.
Un bundle de Expo correcto no equivale a una prueba en un dispositivo físico.

En esta adaptación se verificaron nueve pruebas automáticas (incluida la API local
con un motor simulado), la fragmentación real
de 3601 segundos y la exportación Android. La prueba de inferencia real no pudo
completarse en el entorno de desarrollo: el enlace generó un ejecutable vacío.
No se afirma que el reconocimiento ni su rendimiento estén ya validados en Android.

## Si algo no funciona

- **Pide una clave:** estás ejecutando el código antiguo. Detén el servicio y aplica
  el comando de actualización de arriba. No crees una clave ni pagues créditos.
- **Falta el motor/modelo:** vuelve a ejecutar `bash scripts/setup-offline-termux.sh`.
- **CMake, descarga o checksum fallan:** detente y conserva el mensaje. No borres
  Termux ni tus audios. Una descarga fallida no se usa como modelo.
- **Expo Go incompatible:** selecciona SDK 54 en el enlace oficial de Expo Go.
- **No responde el servicio:** mantén Termux abierto y vuelve a iniciar
  `bash scripts/start-termux.sh`.
- **Android cierra procesos o el teléfono se calienta:** usa un audio corto y espera
  a que el dispositivo se enfríe. No prometemos ejecución en segundo plano.
- **Resultado incorrecto:** el modelo pequeño tiene límites de precisión. Conserva
  el original y revisa el texto; no sustituyas una comprobación humana por la app.

Documentación de referencia: [whisper.cpp](https://github.com/ggml-org/whisper.cpp),
[modelos](https://huggingface.co/ggerganov/whisper.cpp) y
[Expo CLI sin conexión](https://docs.expo.dev/more/expo-cli/#offline).
