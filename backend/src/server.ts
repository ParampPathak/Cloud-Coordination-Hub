import { createApp } from './app.js';
import { readConfig } from './config.js';
import { createStore } from './store.js';
const config = readConfig();
const store = createStore(config);
await store.ready();
const server = createApp(config, store).listen(config.PORT, config.HOST, () =>
  console.log(
    JSON.stringify({
      level: 'info',
      message: 'Cloud Coordination Hub started',
      url: `http://${config.HOST}:${config.PORT}`,
      database: store.kind,
    }),
  ),
);
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () => {
    server.close(() => {
      store.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  });
