import { createServer } from 'node:http';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { createApp } from './app.js';
import { AgentOrchestrator } from './orchestrator.js';
import { ProviderHub } from './providers.js';
import { createStore } from './store.js';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
config({ path: join(repositoryRoot, '.env') });
if (process.env.THREAD_DATA_DIR && !isAbsolute(process.env.THREAD_DATA_DIR)) {
  process.env.THREAD_DATA_DIR = join(repositoryRoot, process.env.THREAD_DATA_DIR);
}
const port = Number(process.env.PORT || 8787);
const store = createStore(process.env, join(repositoryRoot, '.thread-data'));
await store.initialize();
const providers = new ProviderHub(process.env);
await providers.initialize();
const orchestrator = new AgentOrchestrator(process.env);
await orchestrator.initialize();

const server = createServer(
  createApp({
    store,
    environment: process.env,
    providers,
    orchestrator,
    uploadDirectory: join(repositoryRoot, '.thread-data', 'uploads'),
  }),
);
server.listen(port, '127.0.0.1', () => {
  process.stdout.write(
    `THREAD API listening on http://127.0.0.1:${port} (${store.mode})\n`,
  );
});

function shutdown(signal: string) {
  process.stdout.write(`THREAD API received ${signal}; closing cleanly.\n`);
  server.close(() => {
    void Promise.all([store.close(), orchestrator.close()]).then(() => process.exit(0));
  });
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
