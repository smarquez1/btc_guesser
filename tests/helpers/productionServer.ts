import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { availableOrigin } from './availableOrigin.ts';

export async function startProductionServer(environment: NodeJS.ProcessEnv) {
  for (let attempt = 0; ; attempt += 1) {
    // The real entrypoint requires a positive PORT. Ask the OS for one first.
    const origin = await availableOrigin();
    const server = launchProductionServer({
      ...environment, PORT: new URL(origin).port, APP_ORIGIN: origin,
    });

    try {
      await server.ready(origin);

      return { ...server, origin };
    } catch (error) {
      await server.close();

      // Another process could claim the port between selection and child startup.
      if (attempt >= 2 || !server.output().includes('EADDRINUSE')) {
        throw error;
      }
    }
  }
}

export function launchProductionServer(environment: NodeJS.ProcessEnv, entrypoint = 'server/index.ts') {
  const child = spawn(process.execPath, ['--import', 'tsx', entrypoint], {
    env: { ...environment, NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const exited = once(child, 'exit');

  async function ready(origin: string) {
    const deadline = Date.now() + 10_000;

    while (Date.now() < deadline) {
      if (child.exitCode !== null) {
        throw new Error(`Production server exited: ${output}`);
      }

      if (!output.includes(`Server listening at ${origin}`)) {
        await delay(50);
        continue;
      }

      try {
        const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(500) });
        await response.arrayBuffer();

        if (response.ok) {
          return;
        }
      } catch {
        // Wait for the listening socket, with a bounded startup deadline.
      }

      await delay(50);
    }

    throw new Error(`Production server did not become ready: ${output}`);
  }

  async function close() {
    if (child.exitCode !== null || child.signalCode !== null) {
      return;
    }

    child.kill('SIGTERM');
    const timeout = setTimeout(() => child.kill('SIGKILL'), 5000);

    try {
      await exited;
    } finally {
      clearTimeout(timeout);
    }
  }

  return { ready, close, exited, output: () => output };
}
