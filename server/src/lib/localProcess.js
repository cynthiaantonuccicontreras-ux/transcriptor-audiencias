import { spawn } from 'node:child_process';

const activeProcesses = new Set();
export function stopLocalProcesses() {
  for (const child of activeProcesses) child.kill('SIGKILL');
}

// Sin shell. Las rutas no se ejecutan como comandos y el diagnóstico se limita.
export function runLocalProcess(command, args, { onStderr, timeoutMs = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    activeProcesses.add(child);
    let diagnostic = '';
    let timedOut = false;
    const timer = timeoutMs > 0 ? setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs) : null;
    timer?.unref();

    child.stderr.on('data', (data) => {
      const text = data.toString();
      diagnostic = (diagnostic + text).slice(-4096);
      onStderr?.(text);
    });
    child.on('error', (error) => {
      activeProcesses.delete(child);
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code, signal) => {
      activeProcesses.delete(child);
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error('El motor local superó el tiempo máximo para un fragmento.'));
      } else if (code !== 0) {
        reject(new Error('El proceso local terminó (' + (signal || code) + '): ' + diagnostic.slice(-1200)));
      } else {
        resolve();
      }
    });
  });
}
