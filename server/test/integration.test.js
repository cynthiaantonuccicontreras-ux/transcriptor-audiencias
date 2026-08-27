import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitAudio } from '../src/services/audioSplitter.js';
import { runLocalProcess } from '../src/lib/localProcess.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

test('integración: motor real, HTTP, texto, error y limpieza sin API', {
  skip: process.env.RUN_WHISPER_INTEGRATION !== '1', timeout: 180000,
}, async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'whisper-real-test-'));
  const child = spawn(process.execPath, [path.join(root, 'server/src/index.js')], {
    cwd: dir,
    env: { ...process.env, OPENAI_API_KEY: '', HOST: '127.0.0.1', PORT: '0',
      TRANSCRIPTION_LANGUAGE: 'en', LOCAL_CHUNK_SECONDS: '10' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => { log = (log + d).slice(-10000); });
  child.stderr.on('data', (d) => { log = (log + d).slice(-10000); });
  t.after(async () => {
    if (child.exitCode === null) {
      const closed = once(child, 'close');
      child.kill('SIGTERM');
      await closed;
    }
    await fs.rm(dir, { recursive: true, force: true });
  });

  for (let i = 0; i < 100 && !/127\.0\.0\.1:(\d+)/.test(log); i++) await pause(100);
  const match = log.match(/127\.0\.0\.1:(\d+)/);
  assert.ok(match, log);
  const url = 'http://127.0.0.1:' + match[1];
  assert.equal((await (await fetch(url + '/health')).json()).paidApi, false);
  assert.equal((await fetch(url + '/health', { headers: { Origin: 'https://evil.example' } })).status, 403);
  // Peticiones inválidas liberan el cupo; no bloquean trabajos posteriores.
  for (let i = 0; i < 3; i++) assert.equal((await fetch(url + '/api/transcriptions', { method: 'POST' })).status, 400);

  async function submit(bytes) {
    const form = new FormData();
    form.append('audio', new Blob([bytes], { type: 'audio/wav' }), 'sample.wav');
    const response = await fetch(url + '/api/transcriptions', { method: 'POST', body: form });
    assert.equal(response.status, 202);
    const { jobId } = await response.json();
    let job;
    for (let i = 0; i < 1400; i++) {
      job = await (await fetch(url + '/api/transcriptions/' + jobId)).json();
      if (['completed', 'failed'].includes(job.status)) return job;
      await pause(100);
    }
    throw new Error('No terminó: ' + JSON.stringify(job));
  }
  const sample = await fs.readFile(path.join(root, 'local-runtime/whisper.cpp-1.8.2/samples/jfk.wav'));
  const job = await submit(sample);
  assert.equal(job.status, 'completed', job.error);
  assert.match(job.text, /country/i);
  assert.ok(job.totalParts >= 2);
  assert.equal(job.progress, 100);
  console.log('Transcripción real de muestra pública: ' + job.text);
  const failed = await submit(Buffer.from('not an audio'));
  assert.equal(failed.status, 'failed');
  assert.equal(failed.text, undefined);
  for (let i = 0; i < 20 && (await fs.readdir(path.join(dir, 'uploads'))).length; i++) await pause(100);
  assert.deepEqual(await fs.readdir(path.join(dir, 'uploads')), []);
});

test('fragmentación real de más de una hora sin cargar el archivo en RAM', {
  skip: process.env.RUN_LONG_AUDIO_TEST !== '1', timeout: 60000,
}, async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'whisper-long-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const input = path.join(dir, 'one-hour.flac');
  await runLocalProcess(process.env.FFMPEG_PATH || 'ffmpeg', [
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
    '-i', 'anullsrc=r=16000:cl=mono', '-t', '3601', '-c:a', 'flac', input,
  ]);
  const old = process.env.LOCAL_CHUNK_SECONDS;
  process.env.LOCAL_CHUNK_SECONDS = '120';
  t.after(() => old === undefined ? delete process.env.LOCAL_CHUNK_SECONDS : process.env.LOCAL_CHUNK_SECONDS = old);
  const files = await splitAudio(input, path.join(dir, 'chunks'));
  assert.equal(files.length, 31);
  for (const file of files) assert.ok((await fs.stat(file)).size < 24_000_000);
});
