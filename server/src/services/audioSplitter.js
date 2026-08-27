import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';

const DEFAULT_CHUNK_DURATION_SECONDS = 10 * 60;
const DEFAULT_MAX_CHUNK_BYTES = 24_000_000;

function runFfmpeg(args) {
  if (!ffmpegPath) {
    throw new Error('FFmpeg no está disponible para esta plataforma.');
  }

  return new Promise((resolve, reject) => {
    const process = spawn(ffmpegPath, args, {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';

    process.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    process.on('error', reject);
    process.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`FFmpeg terminó con código ${code}: ${stderr.slice(-1200)}`));
    });
  });
}

/**
 * Convierte cualquier audio compatible con FFmpeg a MP3 mono de 48 kbps y lo
 * divide en bloques cronológicos. A 48 kbps, un bloque de diez minutos ocupa
 * aproximadamente 3,6 MB, con margen amplio frente al límite de 25 MB.
 */
export async function splitAudio(inputPath, outputDirectory) {
  const chunkDuration = Number(
    process.env.CHUNK_DURATION_SECONDS || DEFAULT_CHUNK_DURATION_SECONDS
  );
  const maxChunkBytes = Number(
    process.env.MAX_CHUNK_BYTES || DEFAULT_MAX_CHUNK_BYTES
  );

  if (!Number.isFinite(chunkDuration) || chunkDuration < 60) {
    throw new Error('CHUNK_DURATION_SECONDS debe ser un número de al menos 60.');
  }

  await fs.mkdir(outputDirectory, { recursive: true });
  const outputPattern = path.join(outputDirectory, 'part-%05d.mp3');

  await runFfmpeg([
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
    'libmp3lame',
    '-b:a',
    '48k',
    '-f',
    'segment',
    '-segment_time',
    String(chunkDuration),
    '-reset_timestamps',
    '1',
    '-segment_format',
    'mp3',
    outputPattern,
  ]);

  const files = (await fs.readdir(outputDirectory))
    .filter((name) => /^part-\d{5}\.mp3$/.test(name))
    .sort()
    .map((name) => path.join(outputDirectory, name));

  if (files.length === 0) {
    throw new Error('FFmpeg no pudo generar fragmentos del audio.');
  }

  for (const file of files) {
    const { size } = await fs.stat(file);
    if (size > maxChunkBytes) {
      throw new Error(
        `El fragmento ${path.basename(file)} pesa ${size} bytes y supera el límite seguro. ` +
          'Reduce CHUNK_DURATION_SECONDS.'
      );
    }
  }

  return files;
}
