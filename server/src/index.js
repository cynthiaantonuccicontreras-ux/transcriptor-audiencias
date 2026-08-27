import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import multer from 'multer';

import transcriptionsRouter from './routes/transcriptions.js';

const app = express();
const port = Number(process.env.PORT || 3000);

app.disable('x-powered-by');
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_request, response) => {
  response.json({ ok: true, service: 'transcriptor-audiencias' });
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

app.listen(port, '0.0.0.0', () => {
  console.log(`Servidor listo en http://0.0.0.0:${port}`);
});
