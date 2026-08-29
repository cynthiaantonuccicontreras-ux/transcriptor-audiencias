import axios from 'axios';
import * as FileSystem from 'expo-file-system/legacy';

const POLL_INTERVAL_MS = 1200;
const UPLOAD_TIMEOUT_MS = 10 * 60 * 1000;
const API_URL = (process.env.EXPO_PUBLIC_API_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');

const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function assertApiUrl() {
  if (!API_URL || API_URL.includes('TU_IP_LOCAL')) {
    throw new Error(
      'Falta configurar EXPO_PUBLIC_API_URL para el servicio local de Termux.'
    );
  }
}

function normalizeAudio(audio) {
  if (!audio?.uri) {
    throw new Error('No se recibió un archivo de audio válido.');
  }

  return {
    uri: audio.uri,
    name: audio.name || `audiencia-${Date.now()}.m4a`,
    type: audio.mimeType || audio.type || 'audio/mp4',
  };
}

/**
 * Sube el audio al microservicio y consulta el avance hasta obtener el texto.
 * La fragmentación y whisper.cpp se ejecutan localmente. No hay llamadas
 * a OpenAI, claves de API ni cobros por transcripción.
 */
export async function transcribeLongAudio(audio, { onProgress, signal } = {}) {
  assertApiUrl();
  const file = normalizeAudio(audio);

  onProgress?.({
    status: 'Subiendo audio...',
    progress: 0.02,
    currentPart: 0,
    totalParts: 0,
  });

  const uploadTask = FileSystem.createUploadTask(
    `${API_URL}/api/transcriptions`,
    file.uri,
    {
      httpMethod: 'POST',
      uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      fieldName: 'audio',
      mimeType: file.type,
      parameters: { originalName: file.name },
    },
    ({ totalBytesSent, totalBytesExpectedToSend }) => {
      if (totalBytesExpectedToSend <= 0) return;
      onProgress?.({
        status: 'Subiendo audio...',
        progress: Math.min(
          0.09,
          0.02 + (totalBytesSent / totalBytesExpectedToSend) * 0.07
        ),
        currentPart: 0,
        totalParts: 0,
      });
    }
  );

  let timeoutId;
  const abortUpload = () => {
    uploadTask.cancelAsync().catch(() => undefined);
  };
  signal?.addEventListener?.('abort', abortUpload, { once: true });

  let uploadResult;
  try {
    uploadResult = await Promise.race([
      uploadTask.uploadAsync(),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          abortUpload();
          reject(
            new Error(
              'La carga tardó más de 10 minutos y se canceló. Inténtalo nuevamente.'
            )
          );
        }, UPLOAD_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    if (error?.message?.includes('10 minutos')) throw error;
    throw new Error(
      'No responde Termux o no fue posible leer el archivo. Mantén abierto el servicio local e inténtalo de nuevo.'
    );
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener?.('abort', abortUpload);
  }

  if (!uploadResult) {
    throw new Error('La carga del audio fue cancelada.');
  }

  let uploadData;
  try {
    uploadData = JSON.parse(uploadResult.body || '{}');
  } catch {
    throw new Error('Termux devolvió una respuesta inválida al subir el audio.');
  }
  if (uploadResult.status < 200 || uploadResult.status >= 300) {
    throw new Error(uploadData.error || 'Termux rechazó el archivo seleccionado.');
  }

  const { jobId } = uploadData;
  if (!jobId) {
    throw new Error('El servidor no devolvió un identificador de transcripción.');
  }

  while (true) {
    if (signal?.aborted) {
      throw new Error('Transcripción cancelada.');
    }

    await wait(POLL_INTERVAL_MS);
    const response = await axios.get(
      `${API_URL}/api/transcriptions/${jobId}`,
      { signal, timeout: 15000 }
    );
    const job = response.data;

    onProgress?.({
      status: job.message,
      progress: Math.max(0.1, (job.progress || 0) / 100),
      currentPart: job.currentPart || 0,
      totalParts: job.totalParts || 0,
    });

    if (job.status === 'completed') {
      return {
        text: job.text,
        jobId,
        fileName: job.fileName || file.name,
      };
    }

    if (job.status === 'failed') {
      throw new Error(job.error || 'No fue posible completar la transcripción.');
    }
  }
}

export async function checkServerHealth() {
  assertApiUrl();
  const response = await axios.get(`${API_URL}/health`, { timeout: 5000 });
  return response.data;
}
