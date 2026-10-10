import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readConfig } from '../backend/src/config.js';
import { DynamoStore } from '../backend/src/store.js';
import { HubService } from '../backend/src/service.js';
import type { HubEvent, User } from '../shared/types.js';
describe.skipIf(process.env.RUN_DYNAMODB_TESTS !== 'true')(
  'DynamoDB Local integration',
  () => {
    it('uses real conditional transactions for concurrent registration and promotion', async () => {
      const config = readConfig({
        DATABASE_DRIVER: 'dynamodb',
        DYNAMODB_ENDPOINT:
          process.env.DYNAMODB_ENDPOINT ?? 'http://127.0.0.1:8000',
        DYNAMODB_TABLE:
          process.env.DYNAMODB_TABLE ?? 'cloud-coordination-local',
      });
      const storeA = new DynamoStore(config);
      const storeB = new DynamoStore(config);
      const suffix = randomUUID();
      const organizer: User = {
        id: `org-${suffix}`,
        name: 'Organizer',
        email: 'org@example.test',
        role: 'organizer',
      };
      const attendee = (i: number): User => ({
        id: `user-${suffix}-${i}`,
        name: `Attendee ${i}`,
        email: `user${i}@example.test`,
        role: 'user',
      });
      const services = [new HubService(storeA), new HubService(storeB)];
      let eventId = '';
      try {
        await storeA.ready();
        const event = await services[0].createEvent(organizer, {
          title: 'Dynamo Local concurrency',
          description: 'Local integration test',
          location: 'Local',
          startsAt: new Date(Date.now() + 86400_000).toISOString(),
          capacity: 3,
        });
        eventId = event.id;
        await Promise.all(
          Array.from({ length: 12 }, (_, i) =>
            services[i % 2].register(attendee(i), event.id),
          ),
        );
        let data = (await storeA.get<HubEvent>('event', event.id))!.data;
        expect(data.registrations).toHaveLength(12);
        expect(
          data.registrations.filter((r) => r.status === 'confirmed'),
        ).toHaveLength(3);
        const first = data.registrations.find((r) => r.status === 'confirmed')!;
        const next = data.registrations
          .filter((r) => r.status === 'waitlisted')
          .sort((a, b) => a.sequence - b.sequence)[0];
        await services[0].cancel(
          { ...attendee(0), id: first.userId },
          event.id,
        );
        data = (await storeB.get<HubEvent>('event', event.id))!.data;
        expect(
          data.registrations.find((r) => r.userId === next.userId)?.status,
        ).toBe('confirmed');
        expect(
          data.registrations.filter((r) => r.status === 'confirmed'),
        ).toHaveLength(3);
        await expect(
          services[1].register({ ...attendee(0), id: next.userId }, event.id),
        ).rejects.toMatchObject({ status: 409 });
      } finally {
        if (eventId) {
          await storeA.remove('event', eventId);
          const activities = await storeA.list<{
            id: string;
            resourceId: string;
          }>('activity');
          for (const a of activities.filter((a) => a.resourceId === eventId))
            await storeA.remove('activity', a.id);
        }
        storeA.close();
        storeB.close();
      }
    });
  },
);
