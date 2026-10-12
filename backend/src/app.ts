import { pollSchema } from './polls.js';
import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { z, ZodError } from 'zod';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { allowedOrigins, type Config } from './config.js';
import type { Store } from './store.js';
import { HubService, HttpError } from './service.js';
import {
  createUser,
  login,
  sessionUser,
  tokenKey,
  passwordPolicy,
} from './auth.js';
import type { User } from '../../shared/types.js';
const text = z.string().trim().min(1).max(160);
const future = z.iso
  .datetime({ offset: true })
  .refine(
    (value) => Date.parse(value) > Date.now(),
    'Choose a future date and time.',
  );
const eventSchema = z
  .object({
    title: text,
    description: z.string().trim().max(4000),
    location: z.string().trim().min(1).max(300),
    startsAt: future,
    capacity: z.number().int().min(1).max(250),
  })
  .strict();
const slotSchema = z
  .object({
    title: text,
    location: text,
    startsAt: future,
    endsAt: z.iso.datetime({ offset: true }),
  })
  .strict()
  .refine(
    (slot) => Date.parse(slot.endsAt) > Date.parse(slot.startsAt),
    'End time must follow the start time.',
  );
const credentials = z
  .object({
    email: z
      .email()
      .max(254)
      .transform((v) => v.toLowerCase()),
    password: z.string().min(1).max(128),
  })
  .strict();
export function createApp(config: Config, store: Store, logging = true) {
  const app = express();
  const service = new HubService(store);
  const origins = allowedOrigins(config);
  app.disable('x-powered-by');
  // The deployed application must be reachable only from the ALB security group.
  if (config.NODE_ENV === 'production') app.set('trust proxy', 1);
  app.use(helmet());
  app.use(express.json({ limit: '32kb' }));
  app.use(cookieParser());
  app.use((req, res, next) => {
    const id = randomUUID();
    res.setHeader('X-Request-Id', id);
    const started = performance.now();
    if (logging)
      res.on('finish', () =>
        console.log(
          JSON.stringify({
            level: res.statusCode >= 500 ? 'error' : 'info',
            requestId: id,
            method: req.method,
            path: req.path,
            status: res.statusCode,
            durationMs: Math.round(performance.now() - started),
          }),
        ),
      );
    next();
  });
  app.get('/api/health', (_req, res) =>
    res.json({ status: 'ok', database: store.kind }),
  );
  app.get('/api/ready', async (_req, res) => {
    try {
      await store.ready();
      res.json({ status: 'ready', database: store.kind });
    } catch {
      res.status(503).json({ error: 'Database unavailable.' });
    }
  });
  app.use(
    '/api',
    rateLimit({
      windowMs: 60_000,
      limit: 240,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
    }),
  );
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      (typeof req.headers.origin !== 'string' ||
        !origins.has(req.headers.origin))
    )
      return next(new HttpError(403, 'Request origin is not permitted.'));
    next();
  });
  app.use(
    '/api/auth',
    rateLimit({
      windowMs: 15 * 60_000,
      limit: 80,
      skip: (req) => req.method === 'GET',
      standardHeaders: 'draft-8',
      legacyHeaders: false,
    }),
  );
  app.post('/api/auth/register', async (req, res) => {
    const input = credentials
      .extend({
        name: z.string().trim().min(1).max(80),
        password: z
          .string()
          .regex(
            passwordPolicy,
            'Use 12–128 characters including uppercase, lowercase, and a number.',
          ),
      })
      .parse(req.body);
    const user = await createUser(
      store,
      input.email,
      input.name,
      input.password,
    );
    res.status(201).json(user);
  });
  const cookieOptions = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: config.NODE_ENV === 'production',
    path: '/',
    maxAge: 8 * 60 * 60 * 1000,
  };
  app.post('/api/auth/login', async (req, res) => {
    const input = credentials.parse(req.body);
    const result = await login(store, input.email, input.password);
    res.cookie('hub_session', result.token, cookieOptions).json(result.user);
  });
  app.post('/api/auth/logout', async (req, res) => {
    if (typeof req.cookies.hub_session === 'string')
      await store.remove('session', tokenKey(req.cookies.hub_session));
    res
      .clearCookie('hub_session', { ...cookieOptions, maxAge: undefined })
      .json({ success: true });
  });
  app.use('/api', async (req, res, next) => {
    const user = await sessionUser(store, req.cookies.hub_session);
    if (!user) return next(new HttpError(401, 'Sign in to continue.'));
    res.locals.user = user;
    next();
  });
  const user = (res: express.Response) => res.locals.user as User;
  const id = (req: express.Request) => z.uuid().parse(req.params.id);
  app.get('/api/auth/me', (_req, res) => res.json(user(res)));
  app.get('/api/snapshot', async (_req, res) =>
    res.json(await service.snapshot(user(res))),
  );
  app.post('/api/events', async (req, res) =>
    res
      .status(201)
      .json(await service.createEvent(user(res), eventSchema.parse(req.body))),
  );
  app.put('/api/events/:id', async (req, res) =>
    res.json(
      await service.editEvent(user(res), id(req), eventSchema.parse(req.body)),
    ),
  );
  app.post('/api/events/:id/registrations', async (req, res) =>
    res.status(201).json(await service.register(user(res), id(req))),
  );
  app.delete('/api/events/:id/registrations/me', async (req, res) =>
    res.json(await service.cancel(user(res), id(req))),
  );
  app.get('/api/events/:id/attendees', async (req, res) =>
    res.json(await service.attendees(user(res), id(req))),
  );
  app.get('/api/events/:id/attendees.csv', async (req, res) => {
    const rows = await service.attendees(user(res), id(req));
    const cell = (value: string) =>
      '"' +
      (/^[=+\-@\t\r]/.test(value) ? "'" : '') +
      value.replaceAll('"', '""') +
      '"';
    res
      .attachment('attendees.csv')
      .type('text/csv')
      .send(
        'Name,Status,Sequence\r\n' +
          rows
            .map((r) => `${cell(r.name)},${cell(r.status)},${r.sequence}`)
            .join('\r\n'),
      );
  });
  app.post('/api/polls', async (req, res) =>
    res
      .status(201)
      .json(await service.createPoll(user(res), pollSchema.parse(req.body))),
  );
  app.post('/api/polls/:id/votes', async (req, res) =>
    res.json(
      await service.vote(
        user(res),
        id(req),
        z.object({ option: z.number().int() }).strict().parse(req.body).option,
      ),
    ),
  );
  app.put('/api/polls/:id', async (req, res) =>
    res.json(
      await service.editPoll(user(res), id(req), pollSchema.parse(req.body)),
    ),
  );
  app.post('/api/polls/:id/selections', async (req, res) => {
    const input = z
      .object({ optionIds: z.array(z.string().min(1).max(100)).min(1).max(8) })
      .strict()
      .parse(req.body);
    res.json(await service.selectPoll(user(res), id(req), input.optionIds));
  });
  app.delete('/api/polls/:id/selections/me', async (req, res) =>
    res.json(await service.cancelPoll(user(res), id(req))),
  );
  app.post('/api/polls/:id/state', async (req, res) => {
    const input = z
      .object({ state: z.enum(['draft', 'open', 'closed', 'archived']) })
      .strict()
      .parse(req.body);
    res.json(await service.pollState(user(res), id(req), input.state));
  });
  app.get('/api/polls/:id/participants', async (req, res) => {
    const query = z
      .object({
        search: z.string().max(160).optional(),
        optionId: z.string().max(100).optional(),
        sort: z.enum(['name', 'date']).optional(),
        direction: z.enum(['asc', 'desc']).optional(),
        page: z.coerce.number().int().min(1).max(10000).optional(),
        pageSize: z.coerce.number().int().min(1).max(100).optional(),
        status: z.enum(['confirmed', 'cancelled']).optional(),
      })
      .strict()
      .parse(req.query);
    res.json(await service.pollParticipants(user(res), id(req), query));
  });
  app.delete('/api/polls/:id/participants/:participantId', async (req, res) => {
    z.object({ confirm: z.literal(true) })
      .strict()
      .parse(req.body);
    res.json(
      await service.cancelPoll(
        user(res),
        id(req),
        z.string().min(1).max(100).parse(req.params.participantId),
        true,
      ),
    );
  });
  app.post('/api/polls/:id/close', async (req, res) =>
    res.json(await service.closePoll(user(res), id(req))),
  );
  app.post('/api/slots', async (req, res) =>
    res
      .status(201)
      .json(await service.createSlot(user(res), slotSchema.parse(req.body))),
  );
  app.post('/api/slots/:id/booking', async (req, res) =>
    res.json(await service.bookSlot(user(res), id(req))),
  );
  app.delete('/api/slots/:id/booking', async (req, res) =>
    res.json(await service.cancelSlot(user(res), id(req))),
  );
  app.use('/api', (_req, _res, next) =>
    next(new HttpError(404, 'API endpoint was not found.')),
  );
  const assets = resolve('dist/frontend');
  app.use(express.static(assets));
  app.get('/{*path}', (_req, res, next) =>
    res.sendFile(
      resolve(assets, 'index.html'),
      (error) => error && next(error),
    ),
  );
  app.use(
    (
      error: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      void _next;
      if (error instanceof ZodError)
        return res.status(400).json({
          error: error.issues
            .map((i) => `${i.path.join('.')}: ${i.message}`)
            .join('; '),
        });
      if (error instanceof HttpError)
        return res.status(error.status).json({ error: error.message });
      if (error instanceof SyntaxError && 'body' in error)
        return res.status(400).json({ error: 'Invalid JSON body.' });
      if ((error as { type?: string })?.type === 'entity.too.large')
        return res.status(413).json({ error: 'Request body is too large.' });
      if (logging)
        console.error(
          JSON.stringify({
            level: 'error',
            requestId: res.getHeader('X-Request-Id'),
            message: 'Unhandled request failure',
            type: error instanceof Error ? error.name : 'unknown',
          }),
        );
      res.status(500).json({
        error: 'The request could not be completed. Please try again.',
      });
    },
  );
  return app;
}
