import axios from 'axios';

const POLL_INTERVAL_MS = 1200;
const API_URL = (process.env.EXPO_PUBLIC_API_URL || '').replace(/\/$/, '');

const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function assertApiUrl() {
  if (!API_URL || API_URL.includes('TU_IP_LOCAL')) {
    throw new Error(
      'Falta configurar EXPO_PUBLIC_API_URL con la IP local de tu computador.'
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
 * La fragmentación y la llamada a OpenAI ocurren en Node.js para que la clave
 * nunca quede dentro de la aplicación móvil.
 */
export async function transcribeLongAudio(audio, { onProgress, signal } = {}) {
  assertApiUrl();
  const file = normalizeAudio(audio);
  const formData = new FormData();
  formData.append('audio', file);

  onProgress?.({
    status: 'Subiendo audio...',
    progress: 0.02,
    currentPart: 0,
    totalParts: 0,
  });

  const uploadResponse = await axios.post(
    `${API_URL}/api/transcriptions`,
    formData,
    {
      headers: { 'Content-Type': 'multipart/form-data' },
      signal,
      timeout: 0,
      onUploadProgress: ({ loaded, total }) => {
        if (!total) return;
        onProgress?.({
          status: 'Subiendo audio...',
          progress: Math.min(0.09, 0.02 + (loaded / total) * 0.07),
          currentPart: 0,
          totalParts: 0,
        });
      },
    }
  );

  const { jobId } = uploadResponse.data;
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
