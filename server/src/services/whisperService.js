import { createReadStream } from 'node:fs';
import OpenAI from 'openai';

const MAX_ATTEMPTS = 4;
const CONTEXT_CHARACTERS = 700;

function getClient() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('Falta OPENAI_API_KEY en server/.env.');
  }
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

function shouldRetry(error) {
  return error?.status === 429 || (error?.status >= 500 && error?.status <= 599);
}

const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function transcribeOneChunk(client, filePath, previousContext) {
  const model = process.env.OPENAI_TRANSCRIPTION_MODEL || 'whisper-1';
  const language = process.env.TRANSCRIPTION_LANGUAGE || 'es';
  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await client.audio.transcriptions.create({
        file: createReadStream(filePath),
        model,
        language,
        response_format: 'json',
        temperature: 0,
        prompt: previousContext || undefined,
      });
      return String(response.text || '').trim();
    } catch (error) {
      lastError = error;
      if (!shouldRetry(error) || attempt === MAX_ATTEMPTS) throw error;
      await wait(1000 * 2 ** (attempt - 1));
    }
  }

  throw lastError;
}

/**
 * Transcribe secuencialmente para conservar el orden. El final del texto
 * anterior se envía como prompt al siguiente bloque, lo que ayuda a mantener
 * nombres propios y contexto cuando el corte ocurre cerca de una frase.
 */
export async function transcribeChunks(chunkPaths, onPartStart = () => {}) {
  const client = getClient();
  const texts = [];
  let previousContext = '';

  for (let index = 0; index < chunkPaths.length; index += 1) {
    onPartStart(index + 1, chunkPaths.length);
    const text = await transcribeOneChunk(
      client,
      chunkPaths[index],
      previousContext
    );
    if (text) texts.push(text);
    previousContext = text.slice(-CONTEXT_CHARACTERS);
  }

  return texts.join('\n\n').trim();
}
