import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import multer from 'multer';

import transcriptionsRouter from './routes/transcriptions.js';

import { assertLocalEngineAvailable } from './services/whisperService.js';
import { stopLocalProcesses } from './lib/localProcess.js';

const app = express();
const port = Number(process.env.PORT || 3000);

app.disable('x-powered-by');
// El modo teléfono sólo escucha en loopback. Bloquea páginas externas que
// intenten usar el servicio desde el navegador (React Native no envía Origin).
app.use((request, response, next) => {
  const origin = request.headers.origin;
  const allowed = new Set(['http://127.0.0.1:3000', 'http://localhost:3000',
    'http://127.0.0.1:8081', 'http://localhost:8081']);
  if (origin && !allowed.has(origin)) {
    response.status(403).json({ error: 'Origen no permitido.' });
    return;
  }
  next();
});
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/health', async (_request, response) => {
  try {
    await assertLocalEngineAvailable();
    response.json({ ok: true, service: 'transcriptor-audiencias', engine: 'whisper.cpp', paidApi: false });
  } catch (error) {
    response.status(503).json({ ok: false, error: error.message });
  }
});

app.use('/api/transcriptions', transcriptionsRouter);

app.use((error, _request, response, _next) => {
  console.error(error);
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    response.status(413).json({ error: 'El archivo supera el tamaño máximo admitido.' });
    return;
  }
  response.status(400).json({ error: error?.message || 'Solicitud inválida.' });
});

const host = process.env.HOST || '127.0.0.1';
const server = app.listen(port, host, () => {
  console.log('Servidor listo en http://' + host + ':' + server.address().port);
});

function shutdown() {
  stopLocalProcesses();
  server.close();
  process.exit(0);
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
