import axios from 'axios';
import * as FileSystem from 'expo-file-system/legacy';

const POLL_INTERVAL_MS = 1200;
const UPLOAD_CHUNK_BYTES = 256 * 1024;
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
    size: Number(audio.size) || null,
  };
}

async function getAudioSize(file) {
  if (file.size > 0) return file.size;
  const info = await FileSystem.getInfoAsync(file.uri);
  if (!info.exists || !Number.isFinite(info.size) || info.size <= 0) {
    throw new Error('No se pudo determinar el tamaño del audio seleccionado.');
  }
  return info.size;
}

async function uploadInVerifiedChunks(jobId, file, fileSize, { onProgress, signal }) {
  let offset = 0;
  while (offset < fileSize) {
    if (signal?.aborted) throw new Error('Transcripción cancelada.');

    const length = Math.min(UPLOAD_CHUNK_BYTES, fileSize - offset);
    const data = await FileSystem.readAsStringAsync(file.uri, {
      encoding: FileSystem.EncodingType.Base64,
      position: offset,
      length,
    });
    const nextOffset = offset + length;

    let response;
    try {
      response = await axios.post(
        `${API_URL}/api/transcriptions/${encodeURIComponent(jobId)}/chunks`,
        {
          offset,
          data,
          isLast: nextOffset === fileSize,
          totalBytes: fileSize,
        },
        { signal, timeout: 45000 }
      );
    } catch (error) {
      throw new Error(
        error.response?.data?.error ||
          'Termux no pudo recibir una parte del audio. Reinicia el servicio local e inténtalo nuevamente.'
      );
    }

    if (response.data?.nextOffset !== nextOffset) {
      throw new Error('Termux no confirmó correctamente la parte enviada.');
    }
    offset = nextOffset;
    onProgress?.({
      status: `Subiendo audio... ${Math.round((offset / fileSize) * 100)}%`,
      progress: 0.02 + (offset / fileSize) * 0.07,
      currentPart: 0,
      totalParts: 0,
    });
  }
}

/**
 * Sube el audio al microservicio y consulta el avance hasta obtener el texto.
 * La fragmentación y whisper.cpp se ejecutan localmente. No hay llamadas
 * a OpenAI, claves de API ni cobros por transcripción.
 */
export async function transcribeLongAudio(audio, { onProgress, signal } = {}) {
  assertApiUrl();
  const file = normalizeAudio(audio);
  const fileSize = await getAudioSize(file);

  onProgress?.({
    status: 'Preparando carga...',
    progress: 0.01,
    currentPart: 0,
    totalParts: 0,
  });

  let jobId;
  try {
    const createResponse = await axios.post(
      `${API_URL}/api/transcriptions/jobs`,
      { fileName: file.name, fileSize },
      { signal, timeout: 15000 }
    );
    jobId = createResponse.data?.jobId;
  } catch (error) {
    throw new Error(
      error.response?.data?.error ||
        'No se pudo iniciar la carga en Termux. Reinicia el servicio local e inténtalo nuevamente.'
    );
  }
  if (!jobId) {
    throw new Error('Termux no devolvió el identificador de la transcripción.');
  }

  await uploadInVerifiedChunks(jobId, file, fileSize, { onProgress, signal });

  let missingJobAttempts = 0;
  while (true) {
    if (signal?.aborted) {
      throw new Error('Transcripción cancelada.');
    }

    await wait(POLL_INTERVAL_MS);
    let response;
    try {
      response = await axios.get(
        `${API_URL}/api/transcriptions/${encodeURIComponent(jobId)}`,
        { signal, timeout: 15000 }
      );
      missingJobAttempts = 0;
    } catch (error) {
      if (error.response?.status === 404 && missingJobAttempts < 4) {
        missingJobAttempts += 1;
        continue;
      }
      throw new Error(
        error.response?.data?.error ||
          'Se perdió la comunicación con la transcripción. Mantén Termux abierto e inténtalo nuevamente.'
      );
    }
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
