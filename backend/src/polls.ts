import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type {
  Poll,
  PollInput,
  PollSettings,
  User,
} from '../../shared/types.js';
import { HttpError } from './errors.js';

export const pollSchema = z
  .object({
    question: z.string().trim().min(1).max(160),
    options: z
      .array(z.string().trim().min(1).max(120))
      .min(2)
      .max(8)
      .refine(
        (o) => new Set(o.map((s) => s.toLowerCase())).size === o.length,
        'Options must be distinct.',
      ),
    mode: z.enum(['standard', 'signup', 'multiple']).optional(),
    capacities: z
      .array(z.number().int().min(1).max(2000).nullable())
      .optional(),
    maxSelections: z.number().int().min(1).max(8).optional(),
    allowOrganizerVote: z.boolean().optional(),
    allowChanges: z.boolean().optional(),
    allowCancellation: z.boolean().optional(),
    anonymous: z.boolean().optional(),
    resultsVisibility: z
      .enum(['always', 'after-vote', 'after-close', 'organizer'])
      .optional(),
    state: z.enum(['draft', 'open']).optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    const mode = input.mode ?? 'standard';
    if (input.capacities && input.capacities.length !== input.options.length)
      ctx.addIssue({
        code: 'custom',
        message: 'Provide one capacity per option.',
      });
    if (
      mode === 'signup' &&
      (!input.capacities || input.capacities.some((c) => c === null))
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Signup topics require individual capacities.',
      });
    if (mode === 'standard' && input.capacities?.some((c) => c !== null))
      ctx.addIssue({
        code: 'custom',
        message: 'Choose signup or multiple choice for capacities.',
      });
    if (
      (input.maxSelections ?? 1) > input.options.length ||
      (mode !== 'multiple' && (input.maxSelections ?? 1) !== 1)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Selection maximum must fit the poll type and options.',
      });
    if (
      (mode === 'signup' || input.capacities?.some((c) => c !== null)) &&
      input.anonymous === true
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Capacity-limited signups must identify participants.',
      });
  });

export function settings(
  input: PollInput,
  ids: string[] = input.options.map(() => randomUUID()),
): PollSettings {
  const parsed = pollSchema.parse(input);
  return {
    mode: parsed.mode ?? 'standard',
    optionIds: ids,
    capacities: parsed.capacities ?? parsed.options.map(() => null),
    maxSelections: parsed.maxSelections ?? 1,
    allowOrganizerVote: parsed.allowOrganizerVote ?? false,
    allowChanges: parsed.allowChanges ?? false,
    allowCancellation: parsed.allowCancellation ?? false,
    anonymous:
      parsed.anonymous ??
      !(parsed.mode === 'signup' || parsed.capacities?.some((c) => c !== null)),
    resultsVisibility: parsed.resultsVisibility ?? 'always',
    state: parsed.state ?? 'open',
  };
}

// Deterministic legacy conversion: no identities or invented timestamps added.
export function normalizePoll(
  poll: Poll,
): Poll & { settings: PollSettings; entries: NonNullable<Poll['entries']> } {
  if (!poll.settings) {
    poll.settings = {
      mode: 'standard',
      optionIds: poll.options.map((_, i) => `${poll.id}:${i}`),
      capacities: poll.options.map(() => null),
      maxSelections: 1,
      allowOrganizerVote: true,
      allowChanges: false,
      allowCancellation: false,
      anonymous: true,
      resultsVisibility: 'always',
      state: poll.closed ? 'closed' : 'open',
    };
    for (const option of Object.values(poll.votes)) {
      if (!Number.isInteger(option) || !poll.settings.optionIds[option])
        throw new Error(
          'Legacy poll contains an invalid option index; migration aborted.',
        );
    }
    poll.entries = [];
  }
  poll.entries ??= [];
  poll.schemaVersion = 1;
  return poll as Poll & {
    settings: PollSettings;
    entries: NonNullable<Poll['entries']>;
  };
}

export const canManagePoll = (user: User, poll: Poll) =>
  user.role === 'admin' ||
  (user.role === 'organizer' && user.id === poll.organizerId);
export function managePoll(user: User, poll: Poll) {
  if (!canManagePoll(user, poll))
    throw new HttpError(403, 'Poll owner or administrator access is required.');
}
export function activeEntries(raw: Poll) {
  const poll = normalizePoll(raw);
  const represented = new Set(poll.entries.map((e) => e.userId));
  const legacy = Object.entries(poll.votes)
    .filter(([userId]) => !represented.has(userId))
    .map(([userId, option], i) => ({
      userId,
      optionId: poll.settings.optionIds[option],
      createdAt: null,
      sequence: i + 1,
      status: 'confirmed' as const,
    }));
  return [...legacy, ...poll.entries.filter((e) => e.status === 'confirmed')];
}
