import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getLocalSettings, createProgressParser, createLocalTranscriber, assertLocalEngineAvailable } from '../src/services/whisperService.js';
import { runLocalProcess } from '../src/lib/localProcess.js';
import { createSerialQueue } from '../src/lib/serialQueue.js';
import { splitAudio } from '../src/services/audioSplitter.js';

async function temp(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'transcriptor-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test('configuración gratuita por defecto, española y sin API', () => {
  const settings = getLocalSettings({});
  assert.equal(settings.language, 'es');
  assert.equal(settings.threads, 2);
  assert.match(settings.model, /ggml-base-q5_1\.bin$/);
  assert.throws(() => getLocalSettings({ WHISPER_THREADS: 'NaN' }));
  assert.throws(() => getLocalSettings({ WHISPER_THREADS: '0' }));
  assert.throws(() => getLocalSettings({ WHISPER_CHUNK_TIMEOUT_MS: '-1' }));
});

test('motor ausente: error accionable y sin fallback de pago', async (t) => {
  const dir = await temp(t);
  await assert.rejects(assertLocalEngineAvailable({
    binary: path.join(dir, 'missing'), model: path.join(dir, 'missing.bin'),
  }), /setup-offline-termux/);
});

test('progreso: líneas partidas, sin retroceder, acotado a 100%', () => {
  const values = [];
  const parse = createProgressParser((p) => values.push(p));
  parse('whisper: prog');
  parse('ress =  25%\nprogress = 20%\nprogress = 50');
  parse('%\nprogress = 900%\n');
  assert.deepEqual(values, [0.25, 0.5, 1]);
});

test('secuencia de bloques, orden, espacios en rutas y texto final', async (t) => {
  const dir = await temp(t);
  const files = ['part 1.wav', 'part 2.wav', 'part 3.wav'].map((n) => path.join(dir, n));
  let active = 0;
  let calls = 0;
  const starts = [];
  const progress = [];
  const transcribe = createLocalTranscriber({
    env: { OPENAI_API_KEY: 'unused-poison-value' },
    check: async () => {},
    run: async (_command, args, { onStderr }) => {
      assert.equal(++active, 1);
      const index = calls++;
      assert.equal(args[args.indexOf('-f') + 1], files[index]);
      assert.equal(args[args.indexOf('-l') + 1], 'es');
      onStderr('progress = 50%\n');
      await fs.writeFile(args[args.indexOf('-of') + 1] + '.txt', [' Primero. ', '', 'Tercero.'][index]);
      active -= 1;
    },
  });
  const result = await transcribe(files, {
    onPartStart: (p, total) => starts.push([p, total]),
    onPartProgress: (...p) => progress.push(p),
  });
  assert.equal(result, 'Primero.\n\nTercero.');
  assert.deepEqual(starts, [[1, 3], [2, 3], [3, 3]]);
  assert.deepEqual(progress.at(-1), [3, 3, 1]);
});

test('un bloque fallido no se presenta como transcripción completa', async (t) => {
  const dir = await temp(t);
  let calls = 0;
  const transcribe = createLocalTranscriber({
    env: {}, check: async () => {},
    run: async (_command, args) => {
      if (++calls === 2) throw new Error('fallo simulado');
      await fs.writeFile(args[args.indexOf('-of') + 1] + '.txt', 'Parcial');
    },
  });
  await assert.rejects(transcribe([path.join(dir, 'a'), path.join(dir, 'b')]), /fallo simulado/);
  assert.equal(calls, 2);
});

test('la cola es secuencial y continúa después de un fallo', async () => {
  const enqueue = createSerialQueue();
  const order = [];
  const first = enqueue(async () => { order.push(1); throw new Error('fallo'); });
  const second = enqueue(async () => { order.push(2); });
  await assert.rejects(first, /fallo/);
  await second;
  assert.deepEqual(order, [1, 2]);
});

test('procesos: error de arranque, salida no cero y tiempo máximo', async () => {
  await assert.rejects(runLocalProcess('/missing-local-whisper', []), /ENOENT/);
  await assert.rejects(runLocalProcess(process.execPath, ['-e', 'process.exit(2)']), /terminó/);
  await assert.rejects(runLocalProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeoutMs: 100 }), /tiempo máximo/);
});

test('FFmpeg real: divide sin perder duración y genera WAV PCM 16 kHz', async (t) => {
  const dir = await temp(t);
  const input = path.join(dir, 'entrada con espacios.wav');
  await runLocalProcess(process.env.FFMPEG_PATH || 'ffmpeg', [
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
    '-i', 'sine=frequency=440:duration=5.2', '-ar', '16000', '-ac', '1', input,
  ]);
  const previous = process.env.LOCAL_CHUNK_SECONDS;
  process.env.LOCAL_CHUNK_SECONDS = '2';
  t.after(() => previous === undefined ? delete process.env.LOCAL_CHUNK_SECONDS : process.env.LOCAL_CHUNK_SECONDS = previous);
  const files = await splitAudio(input, path.join(dir, 'chunks'));
  assert.equal(files.length, 3);
  let samples = 0;
  for (const file of files) {
    const data = await fs.readFile(file);
    assert.equal(data.toString('ascii', 0, 4), 'RIFF');
    assert.equal(data.toString('ascii', 8, 12), 'WAVE');
    let cursor = 12;
    while (cursor + 8 <= data.length) {
      const type = data.toString('ascii', cursor, cursor + 4);
      const size = data.readUInt32LE(cursor + 4);
      if (type === 'fmt ') {
        assert.equal(data.readUInt16LE(cursor + 8), 1);
        assert.equal(data.readUInt16LE(cursor + 10), 1);
        assert.equal(data.readUInt32LE(cursor + 12), 16000);
        assert.equal(data.readUInt16LE(cursor + 22), 16);
      }
      if (type === 'data') samples += size / 2;
      cursor += 8 + size + (size % 2);
    }
    assert.ok(data.length < 24_000_000);
  }
  assert.equal(samples, 83200);
  process.env.LOCAL_CHUNK_SECONDS = 'NaN';
  await assert.rejects(splitAudio(input, path.join(dir, 'invalid')), /LOCAL_CHUNK_SECONDS/);
});
