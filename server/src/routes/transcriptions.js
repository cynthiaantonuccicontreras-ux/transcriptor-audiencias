import { Router } from 'express';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import multer from 'multer';

import { createJob, getJob, getPublicJob, updateJob } from '../lib/jobs.js';
import { splitAudio } from '../services/audioSplitter.js';
import { assertLocalEngineAvailable, transcribeChunks } from '../services/whisperService.js';

import { createSerialQueue } from '../lib/serialQueue.js';

const router = Router();
const enqueue = createSerialQueue();
let pendingJobs = 0;
const uploadsRoot = path.resolve(process.cwd(), 'uploads');
const maxUploadBytes = Number(process.env.MAX_UPLOAD_BYTES || 2_000_000_000);

await fs.mkdir(uploadsRoot, { recursive: true });

const upload = multer({
  dest: uploadsRoot,
  limits: {
    files: 1,
    fileSize: maxUploadBytes,
  },
  fileFilter: (_request, file, callback) => {
    const looksLikeAudio =
      file.mimetype.startsWith('audio/') ||
      ['video/mp4', 'application/octet-stream'].includes(file.mimetype);
    callback(
      looksLikeAudio ? null : new Error('El archivo seleccionado no es un audio compatible.'),
      looksLikeAudio
    );
  },
});

function safeFileName(value) {
  if (typeof value !== 'string') return 'audio-sin-nombre';
  return value.trim().slice(0, 500) || 'audio-sin-nombre';
}

async function removePath(targetPath) {
  if (!targetPath) return;
  await fs.rm(targetPath, { recursive: true, force: true });
}

async function processJob(jobId, uploadedFilePath) {
  const chunksDirectory = path.join(uploadsRoot, `${jobId}-chunks`);

  try {
    updateJob(jobId, {
      status: 'splitting',
      message: 'Dividiendo audio...',
      progress: 10,
    });

    const chunkPaths = await splitAudio(uploadedFilePath, chunksDirectory);
    updateJob(jobId, {
      totalParts: chunkPaths.length,
      message: `Transcribiendo parte 1 de ${chunkPaths.length}...`,
      progress: 15,
    });

    const reportProgress = (currentPart, totalParts, fraction = 0) => {
      const progress = 15 + Math.floor(((currentPart - 1 + fraction) / totalParts) * 80);
      updateJob(jobId, {
        status: 'transcribing',
        message: 'Transcribiendo parte ' + currentPart + ' de ' + totalParts + ' en el teléfono...',
        progress,
        currentPart,
        totalParts,
      });
    };
    const text = await transcribeChunks(chunkPaths, {
      onPartStart: (part, total) => reportProgress(part, total, 0),
      onPartProgress: reportProgress,
    });

    updateJob(jobId, {
      status: 'completed',
      message: 'Finalizado',
      progress: 100,
      currentPart: chunkPaths.length,
      totalParts: chunkPaths.length,
      text,
    });
  } catch (error) {
    console.error(`[job ${jobId}]`, error);
    updateJob(jobId, {
      status: 'failed',
      message: 'Error en la transcripción',
      error: error?.message || 'Error inesperado al procesar el audio.',
    });
  } finally {
    pendingJobs -= 1;
    await Promise.allSettled([
      removePath(uploadedFilePath),
      removePath(chunksDirectory),
    ]);
  }
}

router.post('/', async (request, response, next) => {
  if (pendingJobs >= 2) {
    response.status(429).json({ error: 'Ya hay dos audios pendientes. Espera a que terminen.' });
    return;
  }
  // Reserva antes de recibir el archivo para limitar también cargas simultáneas.
  pendingJobs += 1;
  try {
    await assertLocalEngineAvailable();
  } catch (error) {
    pendingJobs -= 1;
    response.status(503).json({ error: error.message });
    return;
  }
  upload.single('audio')(request, response, (error) => {
    if (error) {
      pendingJobs -= 1;
      next(error);
      return;
    }
    next();
  });
}, (request, response) => {
  if (!request.file) {
    pendingJobs -= 1;
    response.status(400).json({ error: 'Debes adjuntar el campo de audio.' });
    return;
  }

  const job = createJob(safeFileName(request.body?.originalName || request.file.originalname));
  response.status(202).json({ jobId: job.id });
  void enqueue(() => processJob(job.id, request.file.path));
});

router.post('/jobs', (request, response) => {
  const job = createJob(safeFileName(request.body?.fileName));
  console.log(`[job ${job.id}] creado para ${job.fileName}`);
  response.status(201).json({ jobId: job.id });
});

router.post('/:jobId/audio', async (request, response, next) => {
  const job = getJob(request.params.jobId);
  if (!job) {
    response.status(404).json({ error: 'La carga no tiene una transcripción asociada.' });
    return;
  }
  if (job.status !== 'queued') {
    response.status(409).json({ error: 'Esta transcripción ya recibió un archivo.' });
    return;
  }
  if (pendingJobs >= 2) {
    response.status(429).json({ error: 'Ya hay dos audios pendientes. Espera a que terminen.' });
    return;
  }
  pendingJobs += 1;
  try {
    await assertLocalEngineAvailable();
  } catch (error) {
    pendingJobs -= 1;
    updateJob(job.id, { status: 'failed', message: 'Motor local no disponible', error: error.message });
    response.status(503).json({ error: error.message });
    return;
  }
  upload.single('audio')(request, response, (error) => {
    if (error) {
      pendingJobs -= 1;
      updateJob(job.id, { status: 'failed', message: 'Error al recibir el audio', error: error.message });
      next(error);
      return;
    }
    next();
  });
}, (request, response) => {
  const job = getJob(request.params.jobId);
  if (!request.file) {
    pendingJobs -= 1;
    updateJob(job.id, { status: 'failed', message: 'Archivo ausente', error: 'Debes adjuntar un audio.' });
    response.status(400).json({ error: 'Debes adjuntar el campo de audio.' });
    return;
  }

  console.log(`[job ${job.id}] audio recibido (${request.file.size} bytes)`);
  response.status(202).json({ jobId: job.id });
  void enqueue(() => processJob(job.id, request.file.path));
});

router.get('/:jobId', (request, response) => {
  const job = getJob(request.params.jobId);
  if (!job) {
    response.status(404).json({ error: 'Transcripción no encontrada o expirada.' });
    return;
  }
  response.json(getPublicJob(job));
});

export default router;
