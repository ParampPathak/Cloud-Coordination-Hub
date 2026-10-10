import 'dotenv/config';
import { z } from 'zod';
export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_ORIGIN: z.url().default('http://localhost:5173'),
  DATABASE_DRIVER: z.enum(['sqlite', 'dynamodb']).default('sqlite'),
  SQLITE_PATH: z.string().default('./data/hub.sqlite'),
  ALLOW_AWS: z.enum(['true', 'false']).default('false'),
  DYNAMODB_ENDPOINT: z.url().optional(),
  DYNAMODB_TABLE: z.string().default('cloud-coordination-local'),
  AWS_REGION: z.string().default('us-east-1'),
});
export type Config = z.infer<typeof envSchema>;
export function readConfig(source = process.env): Config {
  const config = envSchema.parse(source);
  if (config.NODE_ENV === 'production') {
    if (!config.APP_ORIGIN.startsWith('https://'))
      throw new Error('Production requires an HTTPS APP_ORIGIN.');
    if (config.DATABASE_DRIVER !== 'dynamodb')
      throw new Error('Production requires shared DynamoDB storage.');
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
