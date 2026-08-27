import { runLocalProcess } from '../lib/localProcess.js';
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);

function resolveFfmpegPath() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try {
    return require('ffmpeg-static') || 'ffmpeg';
  } catch {
    // En Termux, ffmpeg se instala con `pkg install ffmpeg` y queda en PATH.
    return 'ffmpeg';
  }
}

const ffmpegPath = resolveFfmpegPath();

const DEFAULT_LOCAL_CHUNK_SECONDS = 2 * 60;
const DEFAULT_MAX_CHUNK_BYTES = 24_000_000;


/**
 * Genera WAV PCM mono de 16 kHz para whisper.cpp local. Cada bloque de dos
 * minutos ocupa unos 3,84 MB. El audio se procesa en disco, no entero en RAM.
 */
export async function splitAudio(inputPath, outputDirectory) {
  const chunkDuration = Number(
    process.env.LOCAL_CHUNK_SECONDS || DEFAULT_LOCAL_CHUNK_SECONDS
  );
  const maxChunkBytes = Number(
    process.env.MAX_CHUNK_BYTES || DEFAULT_MAX_CHUNK_BYTES
  );

  if (!Number.isFinite(chunkDuration) || !Number.isInteger(chunkDuration) || chunkDuration < 1 || chunkDuration > 600) {
    throw new Error('LOCAL_CHUNK_SECONDS debe ser un entero entre 1 y 600.');
  }

  if (!Number.isFinite(maxChunkBytes) || maxChunkBytes < 100_000) {
    throw new Error('MAX_CHUNK_BYTES debe ser de al menos 100000.');
  }

  await fs.mkdir(outputDirectory, { recursive: true });
  const outputPattern = path.join(outputDirectory, 'part-%05d.wav');

  await runLocalProcess(ffmpegPath, [
    '-nostdin',
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    inputPath,
    '-map',
    '0:a:0',
    '-vn',
    '-ac',
    '1',
    '-ar',
    '16000',
    '-c:a',
    'pcm_s16le',
    '-f',
    'segment',
    '-segment_time',
    String(chunkDuration),
    '-reset_timestamps',
    '1',
    '-segment_format',
    'wav',
    outputPattern,
  ]);

  const files = (await fs.readdir(outputDirectory))
    .filter((name) => /^part-\d{5,}\.wav$/.test(name))
    .sort((a, b) => Number(a.slice(5, -4)) - Number(b.slice(5, -4)))
    .map((name) => path.join(outputDirectory, name));

  if (files.length === 0) {
    throw new Error('FFmpeg no pudo generar fragmentos del audio.');
  }

  for (const file of files) {
    const { size } = await fs.stat(file);
    if (size > maxChunkBytes) {
      throw new Error(
        `El fragmento ${path.basename(file)} pesa ${size} bytes y supera el límite seguro. ` +
          'Reduce LOCAL_CHUNK_SECONDS.'
      );
    }
  }

  return files;
}
