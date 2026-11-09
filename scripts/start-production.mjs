// Cross-platform production startup; config is still validated by the server.
process.env.NODE_ENV = 'production';
await import('../dist/backend/backend/src/server.js');
