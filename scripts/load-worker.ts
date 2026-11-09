// Isolated local load-test application process. Never used by production startup.
import { createServer } from 'node:http';
import { createApp } from '../backend/src/app.js';
import { createStore } from '../backend/src/store.js';
import { readConfig } from '../backend/src/config.js';
const config = readConfig({
  ...process.env,
  NODE_ENV: 'test',
  ALLOW_AWS: 'false',
});
if (config.DATABASE_DRIVER === 'dynamodb' && !config.DYNAMODB_ENDPOINT)
  throw new Error('Load workers require DynamoDB Local.');
const store = createStore(config);
await store.ready();
const app = createApp(config, store, false);
const server = createServer((req, res) => {
  res.setHeader('X-Test-Instance', String(process.pid));
  app(req, res);
});
server.listen(0, '127.0.0.1', () =>
  process.send?.({
    type: 'ready',
    port: (server.address() as import('node:net').AddressInfo).port,
    pid: process.pid,
  }),
);
let cpu = process.cpuUsage(),
  last = performance.now();
const timer = setInterval(() => {
  const next = process.cpuUsage(),
    now = performance.now();
  process.send?.({
    type: 'sample',
    pid: process.pid,
    rssMiB: process.memoryUsage().rss / 1048576,
    cpuPercent:
      (100 * (next.user + next.system - cpu.user - cpu.system)) /
      ((now - last) * 1000),
  });
  cpu = next;
  last = now;
}, 1000);
process.on('message', (message) => {
  if (message === 'stop') {
    clearInterval(timer);
    server.close(() => {
      store.close();
      process.exit(0);
    });
    server.closeAllConnections();
  }
});
