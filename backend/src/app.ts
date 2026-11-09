import {
  SchedulingService,
  generateSchedule,
  scheduleSchema,
} from './scheduling.js';
import { pollSchema } from './polls.js';
import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { z, ZodError } from 'zod';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { allowedOrigins, packageRoot, type Config } from './config.js';
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
    groupConfiguration: z
      .object({
        count: z.number().int().min(1).max(50),
        capacity: z.number().int().min(1).max(50),
        names: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
        autoAssign: z.boolean().default(true),
        allowSelfSelection: z.boolean().default(true),
      })
      .strict()
      .refine(
        (g) => !g.names || g.names.length === g.count,
        'Provide one name per group.',
      )
      .optional(),
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
  const scheduling = new SchedulingService(store);
  const origins = allowedOrigins(config);
  app.disable('x-powered-by');
  // Single-instance SQLite is behind a local Nginx proxy. Retain the ALB mode.
  if (config.NODE_ENV === 'production')
    app.set(
      'trust proxy',
      config.DATABASE_DRIVER === 'sqlite' ? 'loopback' : 1,
    );
  app.use(
    helmet({
      // Browsers must not upgrade demo HTTP assets to unavailable HTTPS.
      ...(config.NODE_ENV === 'production' &&
      config.APP_ORIGIN.startsWith('http:')
        ? {
            strictTransportSecurity: false,
            contentSecurityPolicy: {
              directives: { 'upgrade-insecure-requests': null },
            },
          }
        : {}),
    }),
  );
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
            route: req.route?.path ?? 'unmatched',
            category:
              res.locals.failureCategory ??
              (res.statusCode === 409 &&
              String(req.route?.path).includes('/slots/')
                ? 'BookingConflict'
                : 'Request'),
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
      limit: 160,
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
    secure:
      config.NODE_ENV === 'production' &&
      config.APP_ORIGIN.startsWith('https:'),
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
  app.use(
    '/api',
    rateLimit({
      windowMs: 60_000,
      limit: 240,
      keyGenerator: (_req, res) => (res.locals.user as User).id,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
    }),
  );
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
      await service.editEvent(
        user(res),
        id(req),
        eventSchema.omit({ groupConfiguration: true }).parse(req.body),
      ),
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
  app.get('/api/events/:id/groups', async (req, res) =>
    res.json(await service.groups(user(res), id(req))),
  );
  app.put('/api/events/:id/groups/membership', async (req, res) => {
    const input = z
      .object({
        groupId: z.uuid().nullable(),
        participantId: z.string().min(1).max(100).optional(),
      })
      .strict()
      .parse(req.body);
    res.json(
      await service.assignGroup(
        user(res),
        id(req),
        input.groupId,
        input.participantId,
      ),
    );
  });
  app.delete('/api/events/:id/attendees/:participantId', async (req, res) => {
    z.object({ confirm: z.literal(true) })
      .strict()
      .parse(req.body);
    res.json(
      await service.removeAttendee(
        user(res),
        id(req),
        z.string().min(1).max(100).parse(req.params.participantId),
      ),
    );
  });
  app.get('/api/events/:id/groups.csv', async (req, res) => {
    // attendees() performs the ownership check before a membership export.
    await service.attendees(user(res), id(req));
    const groups = await service.groups(user(res), id(req));
    const cell = (value: string) =>
      `"${(/^[=+@\-\t\r\n]/.test(value) ? "'" + value : value).replaceAll('"', '""')}"`;
    const rows = [
      ['Group', 'Student'],
      ...groups.flatMap((g) => g.members.map((m) => [g.name, m.name])),
    ];
    res
      .type('text/csv')
      .attachment('groups.csv')
      .send(rows.map((r) => r.map(cell).join(',')).join('\r\n'));
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
    res.json(
      await service.bookSlot(
        user(res),
        id(req),
        z
          .object({ reason: z.string().trim().max(1000).optional() })
          .strict()
          .parse(req.body ?? {}).reason,
      ),
    ),
  );
  app.delete('/api/slots/:id/booking', async (req, res) =>
    res.json(await service.cancelSlot(user(res), id(req))),
  );
  app.post('/api/schedules/preview', async (req, res) => {
    if (user(res).role !== 'organizer')
      throw new HttpError(403, 'Organizer access is required.');
    res.json(generateSchedule(scheduleSchema.parse(req.body)));
  });
  app.post('/api/schedules', async (req, res) =>
    res
      .status(201)
      .json(
        await scheduling.createSchedule(
          user(res),
          scheduleSchema.parse(req.body),
        ),
      ),
  );
  app.put('/api/slots/:id/block', async (req, res) => {
    const input = z.object({ blocked: z.boolean() }).strict().parse(req.body);
    res.json(await scheduling.block(user(res), id(req), input.blocked));
  });
  app.post('/api/slots/:id/reschedule', async (req, res) => {
    const input = z
      .object({
        slotId: z.uuid(),
        reason: z.string().trim().max(1000).default(''),
      })
      .strict()
      .parse(req.body);
    res.json(
      await scheduling.book(user(res), input.slotId, input.reason, id(req)),
    );
  });
  app.delete('/api/slots/:id/bookings/:participantId', async (req, res) => {
    z.object({ confirm: z.literal(true) })
      .strict()
      .parse(req.body);
    res.json(
      await scheduling.cancel(
        user(res),
        id(req),
        z.string().min(1).max(100).parse(req.params.participantId),
      ),
    );
  });
  app.use('/api', (_req, _res, next) =>
    next(new HttpError(404, 'API endpoint was not found.')),
  );
  const assets = resolve(packageRoot(), 'dist/frontend');
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
      res.locals.failureCategory =
        /Dynamo|Transaction|Sqlite|SQLite|Database|ProvisionedThroughput/.test(
          error instanceof Error ? error.name : '',
        )
          ? 'DatabaseFailure'
          : 'ApplicationFailure';
      if (logging)
        console.error(
          JSON.stringify({
            level: 'error',
            requestId: res.getHeader('X-Request-Id'),
            message: 'Unhandled request failure',
            category: res.locals.failureCategory,
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
