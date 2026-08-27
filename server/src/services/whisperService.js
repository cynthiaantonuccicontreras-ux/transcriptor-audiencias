import { constants, promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runLocalProcess } from '../lib/localProcess.js';

const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));

export function getLocalSettings(env = process.env) {
  const threads = Number(env.WHISPER_THREADS || 2);
  const timeoutMs = Number(env.WHISPER_CHUNK_TIMEOUT_MS || 3_600_000);
  if (!Number.isInteger(threads) || threads < 1 || threads > 8) {
    throw new Error('WHISPER_THREADS debe ser un entero entre 1 y 8.');
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1000) {
    throw new Error('WHISPER_CHUNK_TIMEOUT_MS debe ser de al menos 1000.');
  }
  return {
    binary: env.WHISPER_CPP_BIN || path.join(projectRoot, 'local-runtime/whisper.cpp-1.8.2/build/bin/whisper-cli'),
    model: env.WHISPER_MODEL_PATH || path.join(projectRoot, 'local-runtime/models/ggml-base-q5_1.bin'),
    language: env.TRANSCRIPTION_LANGUAGE || 'es',
    threads,
    timeoutMs,
  };
}

export async function assertLocalEngineAvailable(settings = getLocalSettings()) {
  try {
    await fs.access(settings.binary, constants.X_OK);
    await fs.access(settings.model, constants.R_OK);
    const stat = await fs.stat(settings.model);
    if (!stat.isFile() || stat.size === 0) throw new Error('Modelo vacío');
  } catch {
    throw new Error('Falta instalar el motor gratuito. En Termux ejecuta: bash scripts/setup-offline-termux.sh');
  }
}

// Los mensajes de progreso pueden llegar partidos entre varios eventos.
export function createProgressParser(onProgress) {
  let buffer = '';
  let last = 0;
  return (text) => {
    buffer = (buffer + text).slice(-4096);
    const lines = buffer.split(/[\r\n]/);
    buffer = lines.pop();
    for (const line of lines) {
      const match = line.match(/progress\s*=\s*(\d+)%/);
      if (!match) continue;
      const progress = Math.min(100, Math.max(0, Number(match[1])));
      if (progress > last) {
        last = progress;
        onProgress(progress / 100);
      }
    }
  };
}

// Ejecutable real por defecto; inyección para pruebas sin modelo ni API.
// Nunca hay un fallback a una API, incluso si falla la transcripción local.
export function createLocalTranscriber({
  env = process.env,
  run = runLocalProcess,
  check = assertLocalEngineAvailable,
} = {}) {
  return async (chunkPaths, { onPartStart = () => {}, onPartProgress = () => {} } = {}) => {
    const settings = getLocalSettings(env);
    await check(settings);
    const texts = [];

    for (let index = 0; index < chunkPaths.length; index += 1) {
      const part = index + 1;
      onPartStart(part, chunkPaths.length);
      const outputBase = chunkPaths[index] + '.transcription';
      await run(settings.binary, [
        '-m', settings.model,
        '-f', chunkPaths[index],
        '-l', settings.language,
        '-t', String(settings.threads),
        '-ng', '-nt', '-pp',
        '-bs', '1', '-bo', '1',
        '-otxt', '-of', outputBase,
      ], {
        timeoutMs: settings.timeoutMs,
        onStderr: createProgressParser((progress) => onPartProgress(part, chunkPaths.length, progress)),
      });
      // No presentamos un resultado parcial como completo si falta un archivo.
      const text = (await fs.readFile(outputBase + '.txt', 'utf8')).trim();
      texts.push(text);
      onPartProgress(part, chunkPaths.length, 1);
    }

    return texts.filter(Boolean).join('\n\n');
  };
}

export const transcribeChunks = createLocalTranscriber();
