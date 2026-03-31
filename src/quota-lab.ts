import { spawn, type ChildProcess } from 'node:child_process';
import process from 'node:process';

type QuotaLabMode = 'quota' | 'server-error' | 'offline';

const quotaLabMode: QuotaLabMode = process.env.QUOTA_LAB_MODE === 'server-error'
  ? 'server-error'
  : process.env.QUOTA_LAB_MODE === 'offline'
    ? 'offline'
    : 'quota';
const quotaMockHost = process.env.QUOTA_MOCK_HOST?.trim() || '127.0.0.1';
const quotaMockPort = process.env.QUOTA_MOCK_PORT?.trim() || '3015';
const offlinePort = process.env.QUOTA_LAB_OFFLINE_PORT?.trim() || '3999';
const webHost = process.env.QUOTA_LAB_WEB_HOST?.trim() || '127.0.0.1';
const webPort = process.env.QUOTA_LAB_WEB_PORT?.trim() || '4173';
const backendPort = quotaLabMode === 'offline' ? offlinePort : quotaMockPort;
const backendUrl = `http://${quotaMockHost}:${backendPort}`;
const labUrl = `http://${webHost}:${webPort}/?mode=live&backend=${encodeURIComponent(backendUrl)}`;

let closing = false;
const children: ChildProcess[] = [];

const spawnTool = (command: string, args: string[], env: NodeJS.ProcessEnv): ChildProcess => {
  return spawn(command, args, {
    cwd: process.cwd(),
    env,
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });
};

const pipeOutput = (child: ChildProcess, label: string): void => {
  child.stdout?.on('data', (chunk: Buffer) => {
    process.stdout.write(`[${label}] ${chunk.toString()}`);
  });

  child.stderr?.on('data', (chunk: Buffer) => {
    process.stderr.write(`[${label}] ${chunk.toString()}`);
  });
};

const terminateChildren = (): void => {
  if (closing) {
    return;
  }

  closing = true;
  for (const child of children) {
    if (!child.killed) {
      child.kill('SIGTERM');
    }
  }
};

const openBrowser = (): void => {
  if (process.env.CI === 'true') {
    return;
  }

  if (process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', labUrl], { stdio: 'ignore', detached: true });
    return;
  }

  if (process.platform === 'darwin') {
    spawn('open', [labUrl], { stdio: 'ignore', detached: true });
    return;
  }

  spawn('xdg-open', [labUrl], { stdio: 'ignore', detached: true });
};

if (quotaLabMode !== 'offline') {
  const quotaMock = spawnTool('npx', ['ts-node', 'src/quota-mock-server.ts'], {
    ...process.env,
    QUOTA_MOCK_HOST: quotaMockHost,
    QUOTA_MOCK_PORT: quotaMockPort,
    QUOTA_MOCK_MODE: quotaLabMode,
  });
  children.push(quotaMock);
  pipeOutput(quotaMock, 'quota-mock');
} else {
  console.log(`Quota UX lab offline mode: backend expected to be unreachable at ${backendUrl}`);
}

const vite = spawnTool('npm', ['run', 'web:dev', '--', '--host', webHost, '--port', webPort], process.env);
children.push(vite);
pipeOutput(vite, 'vite');

console.log(`Quota UX lab starting in ${quotaLabMode} mode at ${labUrl}`);

let browserOpened = false;
vite.stdout?.on('data', (chunk: Buffer) => {
  const text = chunk.toString();
  if (!browserOpened && text.includes('Local:')) {
    browserOpened = true;
    openBrowser();
    console.log(`Quota UX lab ready: ${labUrl}`);
  }
});

for (const child of children) {
  child.on('exit', (code, signal) => {
    if (!closing && code !== 0 && code !== null) {
      console.error(`Process exited unexpectedly with code ${code}${signal ? ` signal ${signal}` : ''}`);
      terminateChildren();
      process.exitCode = code;
    }
  });
}

process.on('SIGINT', terminateChildren);
process.on('SIGTERM', terminateChildren);
