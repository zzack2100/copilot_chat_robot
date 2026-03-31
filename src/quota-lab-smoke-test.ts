import { spawn, type ChildProcess } from 'node:child_process';
import process from 'node:process';

const host = '127.0.0.1';
const port = process.env.QUOTA_SMOKE_PORT?.trim() || '3022';
const baseUrl = `http://${host}:${port}`;

const spawnTool = (command: string, args: string[], env: NodeJS.ProcessEnv): ChildProcess => {
  return spawn(command, args, {
    cwd: process.cwd(),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });
};

const waitForServer = async (timeoutMs: number): Promise<void> => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // Server not ready yet.
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Timed out waiting for quota mock on ${baseUrl}`);
};

const expect = (condition: boolean, message: string): void => {
  if (!condition) {
    throw new Error(message);
  }
};

const readJson = async (url: string, init?: RequestInit): Promise<{ status: number; body: unknown }> => {
  const response = await fetch(url, init);
  const body = await response.json() as unknown;
  return {
    status: response.status,
    body,
  };
};

const main = async (): Promise<void> => {
  const mock = spawnTool('npx', ['ts-node', 'src/quota-mock-server.ts'], {
    ...process.env,
    QUOTA_MOCK_HOST: host,
    QUOTA_MOCK_PORT: port,
    QUOTA_MOCK_MODE: 'quota',
  });

  mock.stdout?.on('data', (chunk: Buffer) => {
    process.stdout.write(`[quota-mock] ${chunk.toString()}`);
  });
  mock.stderr?.on('data', (chunk: Buffer) => {
    process.stderr.write(`[quota-mock] ${chunk.toString()}`);
  });

  try {
    await waitForServer(15_000);

    const health = await readJson(`${baseUrl}/health`);
    expect(health.status === 200, `Expected /health status 200, got ${health.status}`);

    const initialConfig = await readJson(`${baseUrl}/lab/config`);
    expect(initialConfig.status === 200, `Expected initial /lab/config status 200, got ${initialConfig.status}`);
    expect((initialConfig.body as { mode?: string }).mode === 'quota', 'Expected initial lab mode to be quota');

    const quotaMessage = await readJson(`${baseUrl}/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message: 'test', mode: 'chat_expert' }),
    });
    expect(quotaMessage.status === 429, `Expected quota mode /message status 429, got ${quotaMessage.status}`);

    const switchedConfig = await readJson(`${baseUrl}/lab/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ mode: 'server-error' }),
    });
    expect(switchedConfig.status === 200, `Expected POST /lab/config status 200, got ${switchedConfig.status}`);
    expect((switchedConfig.body as { mode?: string }).mode === 'server-error', 'Expected switched lab mode to be server-error');

    const serverErrorMessage = await readJson(`${baseUrl}/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message: 'test', mode: 'chat_expert' }),
    });
    expect(serverErrorMessage.status === 500, `Expected server-error mode /message status 500, got ${serverErrorMessage.status}`);

    console.log('quota-lab smoke test passed');
  } finally {
    if (!mock.killed) {
      mock.kill('SIGTERM');
    }
  }
};

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});