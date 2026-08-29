import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runLocalProcess } from '../src/lib/localProcess.js';

test('HTTP y limpieza con motor SIMULADO (no valida reconocimiento)', { timeout: 20000 }, async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'transcriptor-http-test-'));
  const binary = path.join(dir, 'fake-whisper.mjs');
  const model = path.join(dir, 'fake-model.bin');
  await fs.writeFile(binary, "#!/usr/bin/env node\nimport fs from 'node:fs';\nconst a=process.argv.slice(2);fs.writeFileSync(a[a.indexOf('-of')+1]+'.txt','Texto simulado');process.stderr.write('progress = 100%\\n');\n", { mode: 0o700 });
  await fs.writeFile(model, 'fake');
  const entry = fileURLToPath(new URL('../src/index.js', import.meta.url));
  const child = spawn(process.execPath, [entry], {
    cwd: dir, env: { ...process.env, PORT: '0', HOST: '127.0.0.1',
      WHISPER_CPP_BIN: binary, WHISPER_MODEL_PATH: model, LOCAL_CHUNK_SECONDS: '2' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => log += d);
  child.stderr.on('data', (d) => log += d);
  t.after(async () => {
    if (child.exitCode === null) { const closed = once(child, 'close'); child.kill('SIGTERM'); await closed; }
    await fs.rm(dir, { recursive: true, force: true });
  });
  const pause = () => new Promise((r) => setTimeout(r, 50));
  for (let i = 0; i < 100 && !/127\.0\.0\.1:(\d+)/.test(log); i++) await pause();
  const match = log.match(/127\.0\.0\.1:(\d+)/);
  assert.ok(match, log);
  const url = 'http://127.0.0.1:' + match[1];
  assert.equal((await (await fetch(url + '/health')).json()).paidApi, false);
  assert.equal((await fetch(url + '/health', { headers: { Origin: 'https://evil.example' } })).status, 403);
  for (let i = 0; i < 3; i++) assert.equal((await fetch(url + '/api/transcriptions', { method: 'POST' })).status, 400);

  const input = path.join(dir, 'input.wav');
  await runLocalProcess('ffmpeg', ['-nostdin', '-loglevel', 'error', '-f', 'lavfi',
    '-i', 'sine=frequency=440:duration=4.5', '-ac', '1', '-ar', '16000', input]);
  async function submit(bytes) {
    const form = new FormData();
    form.append('audio', new Blob([bytes], { type: 'audio/wav' }), 'sample.wav');
    const response = await fetch(url + '/api/transcriptions', { method: 'POST', body: form });
    assert.equal(response.status, 202);
    const { jobId } = await response.json();
    for (let i = 0; i < 100; i++) {
      const job = await (await fetch(url + '/api/transcriptions/' + jobId)).json();
      if (['completed', 'failed'].includes(job.status)) return job;
      await pause();
    }
    throw new Error(log);
  }
  const completed = await submit(await fs.readFile(input));
  assert.equal(completed.status, 'completed', completed.error);
  assert.equal(completed.text, 'Texto simulado\n\nTexto simulado\n\nTexto simulado');
  assert.equal(completed.totalParts, 3);
  assert.equal(completed.progress, 100);

  const createdResponse = await fetch(url + '/api/transcriptions/jobs', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName: 'audiencia dos.mp3', fileSize: (await fs.stat(input)).size }),
  });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();
  assert.match(created.jobId, /^[0-9a-f-]+$/);
  const nativeForm = new FormData();
  nativeForm.append('audio', new Blob([await fs.readFile(input)], { type: 'audio/wav' }), 'audio.wav');
  const nativeUpload = await fetch(url + '/api/transcriptions/' + created.jobId + '/audio', {
    method: 'POST', body: nativeForm,
  });
  assert.equal(nativeUpload.status, 202);
  assert.equal((await nativeUpload.json()).jobId, created.jobId);
  let nativeJob;
  for (let i = 0; i < 100; i++) {
    nativeJob = await (await fetch(url + '/api/transcriptions/' + created.jobId)).json();
    if (['completed', 'failed'].includes(nativeJob.status)) break;
    await pause();
  }
  assert.equal(nativeJob.status, 'completed', nativeJob.error);
  assert.equal(nativeJob.fileName, 'audiencia dos.mp3');

  const chunkedInput = await fs.readFile(input);
  const chunkedCreatedResponse = await fetch(url + '/api/transcriptions/jobs', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName: 'audiencia por partes.wav', fileSize: chunkedInput.length }),
  });
  assert.equal(chunkedCreatedResponse.status, 201);
  const chunkedCreated = await chunkedCreatedResponse.json();
  let offset = 0;
  while (offset < chunkedInput.length) {
    const bytes = chunkedInput.subarray(offset, Math.min(offset + 1000, chunkedInput.length));
    const nextOffset = offset + bytes.length;
    const chunkResponse = await fetch(url + '/api/transcriptions/' + chunkedCreated.jobId + '/chunks', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ offset, data: bytes.toString('base64'),
        totalBytes: chunkedInput.length, isLast: nextOffset === chunkedInput.length }),
    });
    assert.equal(chunkResponse.status, nextOffset === chunkedInput.length ? 202 : 200);
    assert.equal((await chunkResponse.json()).nextOffset, nextOffset);
    offset = nextOffset;
  }
  let chunkedJob;
  for (let i = 0; i < 100; i++) {
    chunkedJob = await (await fetch(url + '/api/transcriptions/' + chunkedCreated.jobId)).json();
    if (['completed', 'failed'].includes(chunkedJob.status)) break;
    await pause();
  }
  assert.equal(chunkedJob.status, 'completed', chunkedJob.error);
  assert.equal(chunkedJob.fileName, 'audiencia por partes.wav');

  const failed = await submit(Buffer.from('invalid audio'));
  assert.equal(failed.status, 'failed');
  assert.equal(failed.text, undefined);
  for (let i = 0; i < 30 && (await fs.readdir(path.join(dir, 'uploads'))).length; i++) await pause();
  assert.deepEqual(await fs.readdir(path.join(dir, 'uploads')), []);
});
