import { freemem, totalmem } from 'node:os';
import { createApp } from './app.js';
import { allowedOrigins, readConfig } from './config.js';
import { createStore, SqliteStore } from './store.js';
const config = readConfig();
const store = createStore(config);
if (store instanceof SqliteStore)
  store.startSessionCleanup(config.SESSION_CLEANUP_SECONDS);
try {
  await store.ready();
} catch (error) {
  console.error(
    JSON.stringify({
      level: 'error',
      message: 'Database startup readiness failed',
      category: 'DatabaseFailure',
      type: error instanceof Error ? error.name : 'unknown',
    }),
  );
  store.close();
  process.exit(1);
}
// CloudWatch Logs metric filters consume these bounded, non-identifying samples.
setInterval(
  () =>
    console.log(
      JSON.stringify({
        level: 'info',
        category: 'RuntimeMetrics',
        memoryUsedPercent: Math.round(100 * (1 - freemem() / totalmem())),
        processMemoryMiB: Math.round(process.memoryUsage().rss / 1048576),
        uptimeSeconds: Math.round(process.uptime()),
      }),
    ),
  60000,
).unref();
const server = createApp(config, store).listen(config.PORT, config.HOST, () =>
  console.log(
    JSON.stringify({
      level: 'info',
      message: 'Cloud Coordination Hub started',
      url: `http://${config.HOST}:${config.PORT}`,
      database: store.kind,
      ...(config.DATABASE_DRIVER === 'sqlite'
        ? { sqlitePath: config.SQLITE_PATH }
        : {}),
      allowedOrigins: [...allowedOrigins(config)],
    }),
  ),
);
server.setTimeout(35000, (socket) => {
  console.warn(
    JSON.stringify({
      level: 'warn',
      category: 'RequestTimeout',
      message: 'Connection idle timeout',
    }),
  );
  socket.destroy();
});
server.requestTimeout = 45000;
server.headersTimeout = 15000;
server.on('error', (error: NodeJS.ErrnoException) => {
  console.error(
    JSON.stringify({
      level: 'error',
      message: 'Server startup failed',
      code: error.code ?? 'UNKNOWN',
    }),
  );
  store.close();
  process.exit(1);
});
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () => {
    server.close(() => {
      store.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  });
