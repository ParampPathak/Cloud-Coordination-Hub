import type { Request, Response, Express } from 'express';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { ipKeyGenerator } from 'express-rate-limit';
import type { Store } from './store.js';
import type { User } from '../../shared/types.js';
import { HttpError } from './errors.js';
import {
  Workspaces,
  canCreateWorkspace,
  workspaceConfig,
} from './workspaces.js';

export const inviteInput = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^[a-zA-Z0-9_-]{43}$/, 'Enter a valid invitation code.'),
  })
  .strict();
export const joinInput = inviteInput.extend({
  workspaceId: z.uuid(),
  confirmation: z.string().regex(/^\d{10}\.[a-f0-9]{64}$/),
});
const fields = z
  .object({
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(500),
    category: z.string().trim().max(80),
  })
  .strict();

export async function withInvitationLimit<T>(
  store: Store,
  req: Request,
  operation: () => Promise<T>,
) {
  const key = createHash('sha256')
    .update(ipKeyGenerator(req.ip ?? ''))
    .digest('hex');
  const window = Math.floor(Date.now() / 900_000);
  const current = () =>
    store.get<{ window: number; failures: number }>('invitation-attempt', key);
  const initial = await current();
  if (initial?.data.window === window && initial.data.failures >= 20)
    throw new HttpError(429, 'Too many invalid invitations. Try again later.');
  try {
    return await operation();
  } catch (error) {
    if (!(error instanceof HttpError) || error.status !== 404) throw error;
    for (let i = 0; i < 32; i++) {
      const row = i === 0 ? initial : await current();
      const failures = row?.data.window === window ? row.data.failures : 0;
      if (
        failures >= 20 ||
        (await store.put(
          'invitation-attempt',
          key,
          { window, failures: failures + 1 },
          row?.version ?? null,
        ))
      )
        throw error;
    }
    throw new HttpError(429, 'Too many invalid invitations. Try again later.');
  }
}

export function workspaceRoutes(app: Express, store: Store) {
  const active = async () => {
    const config = await workspaceConfig(store);
    if (!config) throw new HttpError(503, 'Workspace migration is required.');
    return new Workspaces(store, config.data);
  };
  const user = (res: Response) => res.locals.user as User;
  const id = (req: Request) => z.uuid().parse(req.params.id);
  app.get('/api/workspaces', async (_req, res) => {
    const config = await workspaceConfig(store);
    res.json({
      enabled: Boolean(config),
      canCreate: Boolean(config) && canCreateWorkspace(user(res)),
      items: config
        ? await new Workspaces(store, config.data).list(user(res))
        : [],
    });
  });
  app.post('/api/workspaces', async (req, res) => {
    const {
      name,
      description = '',
      category = '',
    } = fields.partial({ description: true, category: true }).parse(req.body);
    const workspaces = await active();
    res
      .status(201)
      .json(
        await workspaces.create(user(res), { name, description, category }),
      );
  });
  app.post('/api/workspaces/preview', async (req, res) => {
    const data = inviteInput.parse(req.body);
    const preview = await withInvitationLimit(store, req, async () =>
      (await active()).preview(data.code, user(res).id),
    );
    res.json(preview);
  });
  app.post('/api/workspaces/join', async (req, res) => {
    const data = joinInput.parse(req.body);
    res.json(
      await withInvitationLimit(store, req, async () => {
        const workspaces = await active();
        workspaces.confirm(
          data.code,
          data.workspaceId,
          user(res).id,
          data.confirmation,
        );
        return workspaces.join(data.code, data.workspaceId, user(res));
      }),
    );
  });
  app.get('/api/workspaces/:id/management', async (req, res) =>
    res.json(await (await active()).management(user(res), id(req))),
  );
  app.patch('/api/workspaces/:id', async (req, res) => {
    const change = fields
      .partial()
      .extend({
        status: z.enum(['active', 'archived', 'deleted']).optional(),
        invitationsEnabled: z.boolean().optional(),
        rotate: z.boolean().optional(),
        confirmName: z.string().max(80).optional(),
      })
      .parse(req.body);
    res.json(await (await active()).change(user(res), id(req), change));
  });
  app.post('/api/workspaces/:id/managers', async (req, res) => {
    const { email } = z
      .object({ email: z.email().max(254) })
      .strict()
      .parse(req.body);
    await (await active()).appoint(user(res), id(req), email);
    res.status(204).end();
  });
  app.delete('/api/workspaces/:id/members/:member', async (req, res) => {
    z.object({ confirm: z.literal(true) })
      .strict()
      .parse(req.body);
    const target =
      req.params.member === 'me'
        ? user(res).id
        : z.uuid().parse(req.params.member);
    await (await active()).remove(user(res), id(req), target);
    res.status(204).end();
  });
}
