# Transcriptor de Audiencias

Aplicación móvil para Android construida con React Native y Expo. Permite grabar una audiencia o seleccionar un archivo de audio extenso, mostrar el avance del trabajo y entregar una transcripción completa con buscador y copia al portapapeles.

La solución usa dos piezas:

- **Aplicación Expo:** interfaz, grabación, selección del archivo, progreso y resultados.
- **Microservicio Node.js:** recibe el audio, lo convierte con FFmpeg a bloques livianos, los transcribe en orden y une el texto final.

## Uso solo desde Android con Termux

Si no tienes computador, el teléfono puede ejecutar tanto Expo como el servidor local. Usa una versión oficial de Termux instalada desde F-Droid o desde las publicaciones oficiales de GitHub; la antigua versión de Google Play puede ser incompatible.

En Termux, copia y ejecuta esta línea completa:

```bash
pkg update -y && pkg install -y git && git clone https://github.com/cynthiaantonuccicontreras-ux/transcriptor-audiencias.git && cd transcriptor-audiencias && bash scripts/setup-termux.sh
```

Cuando termine, agrega tu clave de OpenAI:

```bash
nano server/.env
```

Reemplaza `sk-reemplaza-esta-linea` por la clave real. Guarda con **Ctrl + O**, confirma con **Enter** y sal con **Ctrl + X**.

Para iniciar todo desde el teléfono:

```bash
cd ~/transcriptor-audiencias && bash scripts/start-termux.sh
```

El script mantiene activo el teléfono, inicia Node/FFmpeg, levanta Expo y trata de abrir Expo Go automáticamente. No cierres Termux mientras estés grabando o transcribiendo.

La separación es necesaria por seguridad y estabilidad: la clave de OpenAI nunca se guarda en el APK ni en el código visible de Expo, y FFmpeg no sobrecarga el teléfono. La API de transcripciones admite archivos de hasta 25 MB; este proyecto genera partes de diez minutos en MP3 mono a 48 kbps (aprox. 3,6 MB cada una).

## Funciones incluidas

- Grabación directa desde el teléfono.
- Carga de archivos de audio desde Android.
- Soporte para audios de más de una hora.
- Pantalla activa durante una grabación extensa.
- Estados en tiempo real: carga, división, parte actual y finalización.
- Reintentos automáticos ante errores temporales de OpenAI.
- Unión cronológica de todos los bloques.
- Buscador con resaltado y contador de coincidencias.
- Copia completa al portapapeles.
- Borrado de audios y fragmentos temporales al finalizar.

## Estructura

```text
transcriptor-audiencias/
├── App.js
├── whisperService.js
├── package.json
├── app.json
├── .env.example
├── src/
│   ├── components/ProgressPanel.js
│   ├── screens/HomeScreen.js
│   ├── screens/ResultsScreen.js
│   └── services/whisperService.js
└── server/
    ├── package.json
    ├── .env.example
    └── src/
        ├── index.js
        ├── lib/jobs.js
        ├── routes/transcriptions.js
        └── services/
            ├── audioSplitter.js
            └── whisperService.js
```

## Requisitos

En el computador:

1. [Git](https://git-scm.com/downloads).
2. [Node.js](https://nodejs.org/) 20.19 o superior.
3. Una clave de la API de OpenAI con facturación habilitada. ChatGPT Plus no incluye automáticamente créditos para la API.

En el teléfono Android:

1. Aplicación **Expo Go** instalada desde Google Play.
2. Teléfono y computador conectados a la misma red Wi-Fi.

El proyecto está fijado en Expo SDK 54 para coincidir con la versión de Expo Go indicada actualmente por la documentación de Expo para aprendizaje y pruebas en un teléfono físico.

## 1. Clonar el repositorio

Abre PowerShell, Terminal o la consola de VS Code en el computador y ejecuta:

```bash
git clone https://github.com/cynthiaantonuccicontreras-ux/transcriptor-audiencias.git
cd transcriptor-audiencias
```

## 2. Instalar dependencias

Instala la aplicación y el servidor:

```bash
npm install
npm --prefix server install
```

`ffmpeg-static` instala el ejecutable de FFmpeg requerido por el servidor; no es necesario instalar FFmpeg manualmente.

Para comprobar que las versiones coincidan con Expo SDK 54:

```bash
npx expo install --fix
npm run doctor
```

## 3. Configurar la clave de OpenAI

Copia el ejemplo del servidor:

### Windows PowerShell

```powershell
Copy-Item server/.env.example server/.env
```

### macOS o Linux

```bash
cp server/.env.example server/.env
```

Abre `server/.env` y reemplaza la primera línea por tu clave real:

```dotenv
OPENAI_API_KEY=sk-tu-clave-real
PORT=3000
OPENAI_TRANSCRIPTION_MODEL=whisper-1
TRANSCRIPTION_LANGUAGE=es
CHUNK_DURATION_SECONDS=600
MAX_CHUNK_BYTES=24000000
MAX_UPLOAD_BYTES=2000000000
```

No subas `server/.env` a GitHub. Ya está excluido mediante `.gitignore`.

## 4. Encontrar la IP local del computador

La app del teléfono no puede usar `localhost`, porque en Android esa palabra apunta al propio teléfono.

### Windows

```powershell
ipconfig
```

Busca **Dirección IPv4** en la conexión Wi-Fi. Un ejemplo habitual es `192.168.1.25`.

### macOS

```bash
ipconfig getifaddr en0
```

### Linux

```bash
hostname -I
```

## 5. Configurar la dirección del servidor en Expo

Copia el archivo de ejemplo de la raíz:

### Windows PowerShell

```powershell
Copy-Item .env.example .env
```

### macOS o Linux

```bash
cp .env.example .env
```

Edita `.env` y reemplaza `TU_IP_LOCAL` por la IP encontrada:

```dotenv
EXPO_PUBLIC_API_URL=http://192.168.1.25:3000
```

No agregues `/api` al final y no uses la clave de OpenAI en este archivo. Las variables `EXPO_PUBLIC_` quedan visibles dentro de la aplicación.

## 6. Iniciar el servidor Node.js

En la primera terminal, desde la raíz del repositorio:

```bash
npm run server
```

Debe aparecer:

```text
Servidor listo en http://0.0.0.0:3000
```

Antes de abrir Expo, escribe en el navegador del teléfono la dirección de prueba, reemplazando la IP:

```text
http://192.168.1.25:3000/health
```

La respuesta correcta es:

```json
{"ok":true,"service":"transcriptor-audiencias"}
```

Si no abre, permite Node.js en el firewall del computador para redes privadas y confirma que ambos equipos estén en la misma Wi-Fi.

## 7. Abrir la aplicación en Android con Expo Go

Sin cerrar el servidor, abre una segunda terminal en la carpeta del proyecto:

```bash
npx expo start --lan --clear
```

Luego:

1. Abre Expo Go en Android.
2. Pulsa **Scan QR code**.
3. Escanea el QR que aparece en la terminal o en el navegador del computador.
4. Autoriza el micrófono cuando Android lo solicite.

Para probar:

1. Pulsa **Iniciar Grabación**.
2. Pulsa **Detener y transcribir**, o usa **Subir Archivo de Audio**.
3. Observa la barra de progreso.
4. En resultados, busca una palabra o copia todo el texto.

## Solución de problemas

### Expo Go indica una versión de SDK incompatible

Ejecuta:

```bash
npx expo install --fix
npx expo start --clear
```

Verifica además que Expo Go esté actualizado. Este repositorio usa SDK 54 deliberadamente para la versión de Expo Go indicada en la guía oficial actual. Para una futura publicación en Google Play conviene migrar al SDK estable más reciente y crear un **development build**.

### La app dice que falta `EXPO_PUBLIC_API_URL`

Comprueba que `.env` esté en la raíz, que tenga la IP correcta y reinicia Expo con:

```bash
npx expo start --clear
```

### `Network Error` o el progreso no comienza

- Abre `/health` desde el navegador del teléfono.
- Mantén `npm run server` funcionando.
- Usa la IP Wi-Fi, no `localhost` ni `127.0.0.1`.
- Revisa el firewall y evita una red de invitados que aísle los dispositivos.

### Error de autenticación o cuota de OpenAI

Revisa `OPENAI_API_KEY`, el saldo y los límites del proyecto en la plataforma de OpenAI. La suscripción de ChatGPT y el uso de la API se facturan por separado.

### El teléfono se queda sin espacio al escoger un audio enorme

Expo copia el archivo seleccionado a la caché para poder subirlo. Libera espacio o usa una grabación comprimida (`m4a` o `mp3`). El servidor vuelve a comprimir el archivo antes de enviarlo a OpenAI.

## Cómo funciona la fragmentación

1. Android envía el archivo completo al servidor local.
2. FFmpeg extrae el audio, lo convierte a mono, 16 kHz y 48 kbps.
3. El audio se divide en bloques de diez minutos ordenados como `part-00000.mp3`, `part-00001.mp3`, etc.
4. El servidor valida que cada bloque pese menos de 24 MB, dejando margen frente al máximo de 25 MB.
5. Cada bloque se transcribe secuencialmente con `whisper-1`.
6. El final del texto anterior se usa como contexto del bloque siguiente para mejorar continuidad y nombres propios.
7. Los textos se unen en orden cronológico.
8. Los archivos de audio temporales se borran; el resultado permanece en memoria durante 24 horas.

## Privacidad y uso en producción

Esta versión es un MVP funcional para uso personal en una red controlada. Antes de exponer el servidor en Internet o usarlo con expedientes de terceros, agrega autenticación, HTTPS, cifrado, una política de retención explícita, almacenamiento persistente protegido y control de acceso. No abras el puerto 3000 públicamente sin esas medidas.

La clave de OpenAI vive únicamente en `server/.env`. Nunca la escribas en `App.js`, `whisperService.js` móvil ni en una variable `EXPO_PUBLIC_*`.

## Documentación oficial

- [OpenAI: transcripción de archivos y entradas largas](https://developers.openai.com/api/docs/guides/speech-to-text)
- [Expo: crear y ejecutar un proyecto](https://docs.expo.dev/get-started/create-a-project/)
- [Expo Audio](https://docs.expo.dev/versions/v54.0.0/sdk/audio/)
- [Expo DocumentPicker](https://docs.expo.dev/versions/v54.0.0/sdk/document-picker/)
- [Expo Clipboard](https://docs.expo.dev/versions/v54.0.0/sdk/clipboard/)
