import 'dotenv/config';
import { z } from 'zod';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';

// Source and compiled CLI/server files share the same repository/package root.
export function packageRoot() {
  let directory = dirname(fileURLToPath(import.meta.url));
  while (true) {
    const manifest = resolve(directory, 'package.json');
    if (
      existsSync(manifest) &&
      JSON.parse(readFileSync(manifest, 'utf8')).name ===
        'cloud-coordination-hub'
    )
      return directory;
    const parent = dirname(directory);
    if (parent === directory)
      throw new Error('Application package root was not found.');
    directory = parent;
  }
}
export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_ORIGIN: z.url().default('http://localhost:5173'),
  ALLOW_INSECURE_HTTP: z.enum(['true', 'false']).default('false'),
  DATABASE_DRIVER: z.enum(['sqlite', 'dynamodb']).default('sqlite'),
  SQLITE_PATH: z.string().default('./data/hub.sqlite'),
  ALLOW_AWS: z.enum(['true', 'false']).default('false'),
  DYNAMODB_ENDPOINT: z.url().optional(),
  DYNAMODB_TABLE: z.string().default('cloud-coordination-local'),
  AWS_REGION: z.string().default('us-east-1'),
});
export type Config = z.infer<typeof envSchema>;
export function allowedOrigins(config: Config): Set<string> {
  const allowed = new Set([config.APP_ORIGIN]);
  const configured = new URL(config.APP_ORIGIN);
  // Explicit local UI ports only. Never trust Host/Forwarded or allow all origins.
  if (
    config.NODE_ENV === 'development' &&
    configured.protocol === 'http:' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(configured.hostname)
  ) {
    const ports = new Set([
      configured.port || '80',
      String(config.PORT),
      '5173',
    ]);
    for (const hostname of ['localhost', '127.0.0.1', '[::1]']) {
      for (const port of ports)
        allowed.add(new URL(`http://${hostname}:${port}`).origin);
    }
  }
  return allowed;
}
export function readConfig(source = process.env): Config {
  const config = envSchema.parse(source);
  const origin = new URL(config.APP_ORIGIN);
  if (
    !['http:', 'https:'].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash
  )
    throw new Error(
      'APP_ORIGIN must be an HTTP(S) origin without credentials, path, query or fragment.',
    );
  config.APP_ORIGIN = origin.origin;
  if (config.SQLITE_PATH !== ':memory:')
    config.SQLITE_PATH = resolve(packageRoot(), config.SQLITE_PATH);
  if (config.NODE_ENV === 'production') {
    if (
      origin.protocol !== 'https:' &&
      !(
        config.ALLOW_INSECURE_HTTP === 'true' &&
        config.DATABASE_DRIVER === 'sqlite'
      )
    )
      throw new Error('Production requires an HTTPS APP_ORIGIN.');
    if (
      config.DATABASE_DRIVER === 'sqlite' &&
      config.SQLITE_PATH === ':memory:'
    )
      throw new Error('Production SQLite requires a persistent file path.');
  }
  if (config.DATABASE_DRIVER === 'dynamodb') {
    if (config.DYNAMODB_ENDPOINT) {
      const url = new URL(config.DYNAMODB_ENDPOINT);
      if (
        !['127.0.0.1', 'localhost', 'dynamodb', '[::1]'].includes(
          url.hostname,
        ) ||
        url.protocol !== 'http:'
      ) {
        throw new Error(
          'Development DynamoDB endpoint must be local HTTP; remote endpoints are forbidden.',
        );
      }
    } else if (config.ALLOW_AWS !== 'true') {
      throw new Error('AWS access is disabled. Use a local DynamoDB endpoint.');
    }
  }
  return config;
}
