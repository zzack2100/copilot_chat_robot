import http from 'node:http';
import process from 'node:process';

type QuotaMockMode = 'quota' | 'server-error';

const host = process.env.QUOTA_MOCK_HOST?.trim() || '127.0.0.1';
const port = Number(process.env.QUOTA_MOCK_PORT ?? '3015');
let mode: QuotaMockMode = process.env.QUOTA_MOCK_MODE === 'server-error' ? 'server-error' : 'quota';

const isQuotaMockMode = (value: unknown): value is QuotaMockMode => value === 'quota' || value === 'server-error';

const getMessageResponse = (): { statusCode: number; body: Record<string, string> } => {
  if (mode === 'server-error') {
    return {
      statusCode: 500,
      body: {
        status: 'error',
        tool: 'chat_expert',
        message: 'Mock backend internal error for toast verification.',
      },
    };
  }

  return {
    statusCode: 429,
    body: {
      error: 'QUOTA_EXCEEDED',
      message: 'Gemini API 配額已達上限',
    },
  };
};

const setCorsHeaders = (response: http.ServerResponse): void => {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
};

const sendJson = (response: http.ServerResponse, statusCode: number, body: unknown): void => {
  setCorsHeaders(response);
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(body));
};

const server = http.createServer((request, response) => {
  if (request.method === 'OPTIONS') {
    setCorsHeaders(response);
    response.writeHead(204);
    response.end();
    return;
  }

  if (request.url === '/health' && request.method === 'GET') {
    sendJson(response, 200, {
      status: 'ok',
      service: `quota-mock:${mode}`,
      version: '1.0.0',
      build: `quota-mock-2026-03-31-${mode}`,
      mode: 'live',
      transport: 'sse',
      capabilities: ['review_code', 'chat_expert', 'get_current_weather', 'search_web', 'get_latest_news'],
      models: [`quota-mock:${mode}`],
      reachable: true,
    });
    return;
  }

  if (request.url === '/lab/config' && request.method === 'GET') {
    sendJson(response, 200, { mode });
    return;
  }

  if (request.url === '/lab/config' && request.method === 'POST') {
    const chunks: Buffer[] = [];
    request.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    request.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        const payload = raw ? JSON.parse(raw) as { mode?: unknown } : {};
        if (!isQuotaMockMode(payload.mode)) {
          sendJson(response, 400, {
            error: 'INVALID_MODE',
            message: 'mode must be quota or server-error',
          });
          return;
        }

        mode = payload.mode;
        sendJson(response, 200, { mode });
      } catch {
        sendJson(response, 400, {
          error: 'INVALID_JSON',
          message: 'Invalid JSON payload',
        });
      }
    });
    return;
  }

  if (request.url === '/message' && request.method === 'POST') {
    const payload = getMessageResponse();
    sendJson(response, payload.statusCode, payload.body);
    return;
  }

  sendJson(response, 404, {
    error: 'NOT_FOUND',
    message: 'Not found',
  });
});

server.listen(port, host, () => {
  console.log(`quota-mock (${mode}) listening on http://${host}:${port}`);
});

const shutdown = (): void => {
  server.close(() => {
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
