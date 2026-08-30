const $ = (selector) => document.querySelector(selector);
const CHUNK_BYTES = 256 * 1024;
const POLL_MS = 1200;

const elements = {
  home: $('#homeView'), result: $('#resultView'), service: $('#serviceStatus'),
  choose: $('#chooseButton'), input: $('#audioFile'), record: $('#recordButton'),
  timer: $('#recordingTimer'), progress: $('#progressCard'), status: $('#progressStatus'),
  percent: $('#progressPercent'), bar: $('#progressBar'), detail: $('#progressDetail'),
  error: $('#errorBox'), fileName: $('#resultFileName'), text: $('#resultText'),
  back: $('#backButton'), copy: $('#copyButton'), download: $('#downloadButton'),
  copyMessage: $('#copyMessage'),
};

let processing = false;
let wakeLock = null;
let mediaRecorder = null;
let mediaStream = null;
let recordingChunks = [];
let recordingStartedAt = 0;
let recordingClock = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function request(url, options = {}, timeoutMs = 60000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const contentType = response.headers.get('content-type') || '';
    const data = contentType.includes('application/json') ? await response.json() : await response.text();
    if (!response.ok) throw new Error(data?.error || `Error del servicio (${response.status}).`);
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Termux tardó demasiado en responder.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function setBusy(value) {
  processing = value;
  elements.choose.disabled = value;
  elements.record.disabled = value;
}

function showProgress(status, percent, detail = '') {
  const bounded = Math.max(0, Math.min(100, Math.round(percent)));
  elements.progress.hidden = false;
  elements.status.textContent = status;
  elements.percent.textContent = `${bounded}%`;
  elements.bar.style.width = `${bounded}%`;
  elements.bar.parentElement.setAttribute('aria-valuenow', String(bounded));
  elements.detail.textContent = detail;
}

function showError(message) {
  elements.error.textContent = message;
  elements.error.hidden = false;
}

function clearError() {
  elements.error.hidden = true;
  elements.error.textContent = '';
}

async function holdScreenAwake() {
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* opcional */ }
}

async function releaseScreen() {
  try { await wakeLock?.release(); } catch { /* opcional */ }
  wakeLock = null;
}

async function uploadFile(file) {
  if (!file || !Number.isFinite(file.size) || file.size <= 0) {
    throw new Error('El archivo seleccionado está vacío o no se puede leer.');
  }

  showProgress('Preparando el audio…', 1, file.name);
  const created = await request('/api/transcriptions/jobs', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName: file.name || 'audio-sin-nombre', fileSize: file.size }),
  }, 20000);
  const jobId = created.jobId;
  if (!jobId) throw new Error('Termux no creó la transcripción.');

  let offset = 0;
  while (offset < file.size) {
    const nextOffset = Math.min(offset + CHUNK_BYTES, file.size);
    const part = file.slice(offset, nextOffset, 'application/octet-stream');
    const complete = nextOffset === file.size ? '1' : '0';
    const result = await request(
      `/api/transcriptions/${encodeURIComponent(jobId)}/binary-chunks?offset=${offset}&totalBytes=${file.size}&isLast=${complete}`,
      { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: part },
    );
    if (result.nextOffset !== nextOffset) throw new Error('Termux no confirmó una parte del audio.');
    offset = nextOffset;
    showProgress('Copiando audio a Termux…', (offset / file.size) * 9, `${Math.round((offset / file.size) * 100)}% del archivo recibido`);
  }
  return jobId;
}

async function waitForResult(jobId) {
  while (true) {
    await sleep(POLL_MS);
    const job = await request(`/api/transcriptions/${encodeURIComponent(jobId)}`, {}, 20000);
    const detail = job.totalParts ? `Parte ${job.currentPart || 1} de ${job.totalParts}` : '';
    showProgress(job.message || 'Procesando…', Math.max(10, job.progress || 0), detail);
    if (job.status === 'failed') throw new Error(job.error || 'No fue posible transcribir el audio.');
    if (job.status === 'completed') return job;
  }
}

function renderResult(result) {
  elements.fileName.textContent = result.fileName || 'Audiencia';
  elements.text.value = result.text || '';
  elements.home.hidden = true;
  elements.result.hidden = false;
  elements.copyMessage.hidden = true;
  window.scrollTo({ top: 0, behavior: 'smooth' });
  try {
    localStorage.setItem('ultimaTranscripcion', JSON.stringify({
      fileName: elements.fileName.textContent, text: elements.text.value, savedAt: Date.now(),
    }));
  } catch { /* el resultado sigue visible */ }
}

async function processFile(file) {
  if (processing) return;
  setBusy(true);
  clearError();
  await holdScreenAwake();
  try {
    const jobId = await uploadFile(file);
    const result = await waitForResult(jobId);
    renderResult(result);
  } catch (error) {
    showError(error.message || 'Ocurrió un error inesperado.');
  } finally {
    setBusy(false);
    await releaseScreen();
  }
}

function formatClock(seconds) {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

async function toggleRecording() {
  if (mediaRecorder?.state === 'recording') {
    mediaRecorder.stop();
    return;
  }
  clearError();
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordingChunks = [];
    mediaRecorder = new MediaRecorder(mediaStream);
    mediaRecorder.addEventListener('dataavailable', (event) => {
      if (event.data.size) recordingChunks.push(event.data);
    });
    mediaRecorder.addEventListener('stop', async () => {
      clearInterval(recordingClock);
      elements.timer.hidden = true;
      elements.record.textContent = '● Grabar ahora';
      mediaStream?.getTracks().forEach((track) => track.stop());
      const type = mediaRecorder.mimeType || 'audio/webm';
      const extension = type.includes('mp4') ? 'm4a' : 'webm';
      const file = new File(recordingChunks, `audiencia-${new Date().toISOString().replace(/[:.]/g, '-')}.${extension}`, { type });
      await processFile(file);
    });
    mediaRecorder.start(1000);
    recordingStartedAt = Date.now();
    elements.choose.disabled = true;
    elements.record.textContent = '■ Detener y transcribir';
    elements.timer.hidden = false;
    recordingClock = setInterval(() => {
      elements.timer.textContent = `Grabando · ${formatClock(Math.floor((Date.now() - recordingStartedAt) / 1000))}`;
    }, 500);
  } catch {
    elements.choose.disabled = false;
    showError('Chrome no pudo usar el micrófono. Puedes seleccionar un audio guardado.');
  }
}

async function checkHealth() {
  try {
    const health = await request('/health', {}, 10000);
    if (!health.ok || health.engine !== 'whisper.cpp') throw new Error();
    elements.service.className = 'service-status ready';
    elements.service.lastElementChild.textContent = 'Whisper está listo en este teléfono';
    elements.choose.disabled = false;
    elements.record.disabled = false;
  } catch {
    elements.service.className = 'service-status error';
    elements.service.lastElementChild.textContent = 'Termux no responde. Vuelve a iniciarlo.';
    elements.choose.disabled = true;
    elements.record.disabled = true;
  }
}

elements.choose.addEventListener('click', () => elements.input.click());
elements.input.addEventListener('change', () => {
  const file = elements.input.files?.[0];
  elements.input.value = '';
  if (file) void processFile(file);
});
elements.record.addEventListener('click', () => void toggleRecording());
elements.back.addEventListener('click', () => {
  elements.result.hidden = true;
  elements.home.hidden = false;
  elements.progress.hidden = true;
  clearError();
  window.scrollTo(0, 0);
});
elements.copy.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(elements.text.value);
  } catch {
    elements.text.focus(); elements.text.select(); document.execCommand('copy');
  }
  elements.copyMessage.hidden = false;
});
elements.download.addEventListener('click', () => {
  const blob = new Blob([elements.text.value], { type: 'text/plain;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${elements.fileName.textContent.replace(/\.[^.]+$/, '') || 'transcripcion'}.txt`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
});
document.addEventListener('visibilitychange', () => {
  if (processing && document.visibilityState === 'visible' && !wakeLock) void holdScreenAwake();
});
window.addEventListener('beforeunload', (event) => {
  if (!processing) return;
  event.preventDefault();
  event.returnValue = '';
});

if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) elements.record.hidden = true;
void checkHealth();
