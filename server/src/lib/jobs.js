import { randomUUID } from 'node:crypto';

const jobs = new Map();
const JOB_TTL_MS = 24 * 60 * 60 * 1000;

export function createJob(fileName) {
  const now = new Date().toISOString();
  const job = {
    id: randomUUID(),
    fileName,
    status: 'queued',
    message: 'Audio recibido. Preparando...',
    progress: 5,
    currentPart: 0,
    totalParts: 0,
    text: null,
    error: null,
    createdAt: now,
    updatedAt: now,
  };
  jobs.set(job.id, job);
  return job;
}

export function updateJob(id, changes) {
  const current = jobs.get(id);
  if (!current) return null;
  const updated = {
    ...current,
    ...changes,
    updatedAt: new Date().toISOString(),
  };
  jobs.set(id, updated);
  return updated;
}

export function getJob(id) {
  return jobs.get(id) || null;
}

export function getPublicJob(job) {
  return {
    id: job.id,
    fileName: job.fileName,
    status: job.status,
    message: job.message,
    progress: job.progress,
    currentPart: job.currentPart,
    totalParts: job.totalParts,
    text: job.status === 'completed' ? job.text : undefined,
    error: job.status === 'failed' ? job.error : undefined,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

setInterval(() => {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [id, job] of jobs.entries()) {
    if (['completed', 'failed'].includes(job.status) && Date.parse(job.updatedAt) < cutoff) jobs.delete(id);
  }
}, 60 * 60 * 1000).unref();
