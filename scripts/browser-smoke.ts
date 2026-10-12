import { chromium, type Browser } from 'playwright-core';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { createApp } from '../backend/src/app.js';
import { readConfig } from '../backend/src/config.js';
import { SqliteStore } from '../backend/src/store.js';
import { createUser } from '../backend/src/auth.js';
import { HubService } from '../backend/src/service.js';

const browserPath =
  process.env.HUB_BROWSER_PATH ??
  (process.platform === 'win32'
    ? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
    : '/usr/bin/google-chrome');
if (!existsSync(browserPath))
  throw new Error(
    'Set HUB_BROWSER_PATH to an installed Chromium/Edge/Chrome executable. No browser is downloaded by this script.',
  );
const dir = mkdtempSync(join(tmpdir(), 'hub-browser-'));
const store = new SqliteStore(join(dir, 'test.sqlite'));
const config = readConfig({
  NODE_ENV: 'test',
  APP_ORIGIN: 'http://localhost:3100',
  SQLITE_PATH: join(dir, 'test.sqlite'),
  PORT: '3100',
});
const server = createApp(config, store, false).listen(3100, '127.0.0.1');
await new Promise<void>((resolve) => server.once('listening', resolve));
const password = `Smoke9-${randomBytes(15).toString('hex')}`;
const failures: string[] = [];
let browser: Browser | undefined;
try {
  const organizer = await createUser(
    store,
    'organizer@example.test',
    'Alex Morgan',
    password,
    'organizer',
  );
  await createUser(store, 'first@example.test', 'Jordan Lee', password);
  await createUser(store, 'second@example.test', 'Taylor Quinn', password);
  const service = new HubService(store);
  const start = new Date(Date.now() + 3 * 86400_000);
  start.setMinutes(0, 0, 0);
  await service.createEvent(organizer, {
    title: 'Cloud architecture studio',
    description:
      'Explore secure networking, service choices, and deployment tradeoffs with your project team.',
    location: 'Engineering Building - Room 204',
    startsAt: start.toISOString(),
    capacity: 12,
  });
  await service.createPoll(organizer, {
    question: 'When should we hold our next workshop?',
    options: ['Tuesday afternoon', 'Wednesday morning', 'Thursday afternoon'],
  });
  browser = await chromium.launch({
    executablePath: browserPath,
    headless: true,
    args: [
      '--disable-background-networking',
      '--disable-component-update',
      '--no-first-run',
    ],
  });
  async function newPage(email: string) {
    const context = await browser!.newContext({
      viewport: { width: 1440, height: 1100 },
    });
    context.setDefaultTimeout(15_000);
    const page = await context.newPage();
    page.on('pageerror', (error) => failures.push(error.message));
    await page.goto('http://localhost:3100');
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('heading', { name: /Hello,/ }).waitFor();
    await page.getByText('Live totals', { exact: true }).waitFor();
    return page;
  }
  const orgPage = await newPage('organizer@example.test');
  await orgPage
    .getByRole('button', { name: 'Create event', exact: true })
    .click();
  await orgPage.getByLabel('Event title').fill('Midpoint waitlist demo');
  await orgPage
    .getByLabel('Description', { exact: true })
    .fill(
      'One seat, two attendees. This is actual local database data used for verification.',
    );
  await orgPage.getByLabel('Location or meeting link').fill('Innovation Lab');
  const local = new Date(start.getTime() - start.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
  await orgPage.getByLabel('Date and time').fill(local);
  await orgPage.getByLabel('Capacity', { exact: true }).fill('1');
  await orgPage
    .getByRole('dialog')
    .getByRole('button', { name: 'Create event', exact: true })
    .click();
  await orgPage
    .getByRole('heading', { name: 'Midpoint waitlist demo', exact: true })
    .waitFor();
  const first = await newPage('first@example.test');
  const second = await newPage('second@example.test');
  const card = (page: typeof first) =>
    page.locator('article').filter({
      has: page.getByRole('heading', {
        name: 'Midpoint waitlist demo',
        exact: true,
      }),
    });
  await card(first)
    .getByRole('button', { name: 'Register', exact: true })
    .click();
  await card(first)
    .getByText(/confirmed/)
    .waitFor();
  await second.getByRole('button', { name: 'Refresh workspace' }).click();
  await card(second).getByRole('button', { name: 'Join waitlist' }).click();
  await card(second).getByText('Waitlist #1', { exact: true }).waitFor();
  await card(first)
    .getByRole('button', { name: 'Cancel registration' })
    .click();
  await card(first).getByRole('button', { name: 'Join waitlist' }).waitFor();
  await second.getByRole('button', { name: 'Refresh workspace' }).click();
  await card(second)
    .getByText(/confirmed/)
    .waitFor();
  console.log(
    'PASS: organizer event creation, confirmed registration, waitlist, cancellation and promotion through the browser.',
  );
  await orgPage.getByRole('link', { name: 'Polls', exact: true }).click();
  await orgPage.getByRole('button', { name: 'Create poll' }).click();
  await orgPage
    .getByLabel('Question', { exact: true })
    .fill('Which demo should we show first?');
  await orgPage.getByLabel('Option 1', { exact: true }).fill('Events');
  await orgPage.getByLabel('Option 2', { exact: true }).fill('Polls');
  await orgPage
    .getByRole('dialog')
    .getByRole('button', { name: 'Create poll' })
    .click();
  await orgPage
    .getByRole('heading', { name: 'Which demo should we show first?' })
    .waitFor();
  await first.getByRole('link', { name: 'Polls', exact: true }).click();
  await first.getByRole('button', { name: 'Refresh workspace' }).click();
  const pollCard = first.locator('article').filter({
    has: first.getByRole('heading', {
      name: 'Which demo should we show first?',
    }),
  });
  await pollCard.getByRole('radio', { name: /^Events/ }).check();
  await pollCard.getByRole('button', { name: 'Submit vote' }).click();
  await pollCard.getByText('Your selection is recorded.').waitFor();
  console.log(
    'PASS: poll creation and authenticated voting through the browser.',
  );
  // Stage 1: identified signups, capacity display, policy changes and administrator management.
  const administrator = await createUser(
    store,
    'admin@example.test',
    'Campus Admin',
    password,
    'admin',
  );
  const adminPage = await newPage(administrator.email);
  await orgPage
    .getByRole('button', { name: 'Create poll', exact: true })
    .click();
  await orgPage
    .getByLabel('Question', { exact: true })
    .fill('Stage 1 topic signup');
  await orgPage
    .getByRole('combobox', { name: /Poll type/ })
    .selectOption('signup');
  await orgPage
    .getByLabel('Option 1', { exact: true })
    .fill(
      'Science and interdisciplinary computing projects with students from across the university',
    );
  await orgPage.getByLabel('Option 2', { exact: true }).fill('Art');
  await orgPage.getByLabel('Capacity 1', { exact: true }).fill('1');
  await orgPage.getByLabel('Capacity 2', { exact: true }).fill('2');
  await orgPage.getByText('Advanced settings', { exact: true }).click();
  await orgPage.getByRole('button', { name: '+ Add Option' }).click();
  await orgPage
    .getByLabel('Option 3', { exact: true })
    .fill('An optional topic with a long name for testing the responsive form');
  await orgPage.getByLabel('Capacity 3', { exact: true }).fill('9');
  mkdirSync('artifacts/poll-ui', { recursive: true });
  await orgPage
    .getByRole('dialog')
    .screenshot({ path: 'artifacts/poll-ui/create-desktop.png' });
  await orgPage.setViewportSize({ width: 390, height: 844 });
  assert(
    await orgPage.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    'Poll modal caused page overflow',
  );
  assert(
    await orgPage
      .getByRole('dialog')
      .evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth),
    'Poll modal content overflowed horizontally',
  );
  await orgPage
    .getByRole('dialog')
    .screenshot({ path: 'artifacts/poll-ui/create-mobile.png' });
  await orgPage
    .getByLabel('Allow cancellation while open', { exact: true })
    .scrollIntoViewIfNeeded();
  await orgPage
    .getByRole('dialog')
    .screenshot({ path: 'artifacts/poll-ui/settings-mobile.png' });
  assert(
    await orgPage
      .getByRole('dialog')
      .getByRole('button', { name: 'Create poll', exact: true })
      .isVisible(),
    'Poll footer was not visible while scrolling',
  );

  await orgPage.getByRole('button', { name: 'Remove option 3' }).click();
  assert.equal(
    await orgPage.getByLabel('Capacity 2', { exact: true }).inputValue(),
    '2',
  );
  await orgPage.setViewportSize({ width: 1440, height: 1100 });

  await orgPage.getByLabel('Allow selection changes', { exact: true }).check();
  await orgPage
    .getByLabel('Allow cancellation while open', { exact: true })
    .check();
  await orgPage
    .getByRole('dialog')
    .getByRole('button', { name: 'Create poll', exact: true })
    .click();
  await orgPage
    .getByRole('heading', { name: 'Stage 1 topic signup' })
    .waitFor();
  const createSignup = (await service.snapshot(organizer)).polls.find(
    (p) => p.question === 'Stage 1 topic signup',
  )!;
  await orgPage.getByRole('button', { name: 'Refresh workspace' }).click();
  const signupCard = (page: typeof first) =>
    page.locator('article').filter({
      has: page.getByRole('heading', { name: 'Stage 1 topic signup' }),
    });
  assert(
    await signupCard(orgPage)
      .getByRole('button', { name: 'Register', exact: true })
      .isDisabled(),
  );
  await first.getByRole('button', { name: 'Refresh workspace' }).click();
  await signupCard(first)
    .getByRole('radio', { name: /^Science/ })
    .check();
  await signupCard(first)
    .getByRole('button', { name: 'Register', exact: true })
    .click();
  await signupCard(first)
    .getByText('Your registration is confirmed.')
    .waitFor();
  await second.getByRole('link', { name: 'Polls', exact: true }).click();
  await second.getByRole('button', { name: 'Refresh workspace' }).click();
  assert(
    await signupCard(second)
      .getByRole('radio', { name: /^Science/ })
      .isDisabled(),
  );
  await signupCard(second).getByRole('radio', { name: /^Art/ }).check();
  await signupCard(second)
    .getByRole('button', { name: 'Register', exact: true })
    .click();
  await signupCard(second)
    .getByText('Your registration is confirmed.')
    .waitFor();
  await second.setViewportSize({ width: 390, height: 844 });
  assert(
    await second.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    'Poll cards overflowed on mobile',
  );
  await signupCard(second).screenshot({
    path: 'artifacts/poll-ui/signup-mobile.png',
  });
  await second.setViewportSize({ width: 1440, height: 1100 });

  await adminPage.getByRole('link', { name: 'Polls', exact: true }).click();
  await adminPage.getByRole('button', { name: 'Refresh workspace' }).click();
  await signupCard(adminPage)
    .getByRole('button', { name: 'Manage poll' })
    .click();
  await signupCard(adminPage)
    .getByRole('cell', { name: 'Jordan Lee', exact: true })
    .waitFor();
  await signupCard(adminPage).getByLabel('Search participants').fill('Jordan');
  await signupCard(adminPage)
    .getByRole('cell', { name: 'first@example.test', exact: true })
    .waitFor();
  adminPage.on('dialog', (dialog) => void dialog.accept());
  await signupCard(adminPage)
    .getByRole('button', { name: 'Remove participant' })
    .click();
  await signupCard(adminPage)
    .getByText('No participants match these filters.')
    .waitFor();
  await second.getByRole('button', { name: 'Refresh workspace' }).click();
  await signupCard(second)
    .getByRole('radio', { name: /^Science/ })
    .check();
  const switchResponse = second.waitForResponse(
    (response) =>
      response.url().includes(`/polls/${createSignup.id}/selections`) &&
      response.request().method() === 'POST',
  );
  await signupCard(second)
    .getByRole('button', { name: 'Change selection' })
    .click();
  assert.equal((await switchResponse).status(), 200);
  assert.deepEqual(
    (
      await service.snapshot({
        ...organizer,
        id: (
          await store.list<import('../shared/types.js').StoredUser>('user')
        ).find((u) => u.email === 'second@example.test')!.id,
      })
    ).polls.find((p) => p.id === createSignup.id)!.mySelections,
    [createSignup.settings!.optionIds[0]],
  );
  await signupCard(second)
    .getByRole('button', { name: 'Cancel selection' })
    .click();
  await signupCard(second)
    .getByRole('button', { name: 'Register', exact: true })
    .waitFor();
  await signupCard(adminPage)
    .getByRole('button', { name: 'Close poll', exact: true })
    .click();
  await signupCard(adminPage)
    .getByText(/^closed.*signup$/)
    .waitFor();
  console.log(
    'PASS: signup capacity, owner voting restriction, participant privacy, admin search/removal, switching, cancellation and closing.',
  );
  await orgPage.getByRole('link', { name: 'Scheduling', exact: true }).click();
  await orgPage.getByRole('button', { name: 'Create time slot' }).click();
  await orgPage.getByLabel('Appointment title').fill('Midpoint office hours');
  await orgPage.getByLabel('Location or meeting link').fill('Room 108');
  await orgPage.getByLabel('Starts at', { exact: true }).fill(local);
  const end = new Date(start.getTime() + 1800_000);
  const endLocal = new Date(end.getTime() - end.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
  await orgPage.getByLabel('Ends at', { exact: true }).fill(endLocal);
  await orgPage
    .getByRole('button', { name: 'Create time slot', exact: true })
    .last()
    .click();
  await orgPage
    .getByRole('heading', { name: 'Midpoint office hours' })
    .waitFor();
  await first.getByRole('link', { name: 'Scheduling', exact: true }).click();
  await first.getByRole('button', { name: 'Refresh workspace' }).click();
  await first.getByRole('button', { name: 'Reserve slot' }).click();
  await first.getByText('Your appointment', { exact: true }).waitFor();
  await second.getByRole('link', { name: 'Scheduling', exact: true }).click();
  await second.getByRole('button', { name: 'Refresh workspace' }).click();
  assert(
    await second
      .getByRole('button', { name: 'Reserved', exact: true })
      .isDisabled(),
  );
  await first.getByRole('button', { name: 'Cancel booking' }).click();
  await first.getByRole('button', { name: 'Reserve slot' }).waitFor();
  console.log(
    'PASS: appointment creation, booking, reserved state and cancellation through the browser.',
  );
  await orgPage.getByRole('link', { name: /^Events/ }).click();
  await orgPage.getByRole('button', { name: 'Refresh workspace' }).click();
  await card(orgPage).getByRole('button', { name: 'Attendees' }).click();
  await orgPage
    .getByRole('dialog')
    .getByRole('cell', { name: 'Taylor Quinn' })
    .waitFor();
  const download = orgPage.waitForEvent('download', { timeout: 15_000 });
  await orgPage.getByRole('link', { name: 'Export CSV' }).click();
  assert.equal((await download).suggestedFilename(), 'attendees.csv');
  await orgPage.getByRole('button', { name: 'Close dialog' }).click();
  console.log('PASS: organizer attendee list and downloadable CSV.');
  mkdirSync('docs/screenshots', { recursive: true });
  await orgPage.getByRole('link', { name: 'Overview', exact: true }).click();
  await orgPage.getByRole('button', { name: 'Refresh workspace' }).click();
  if (
    await orgPage.getByRole('button', { name: 'Dismiss confirmation' }).count()
  )
    await orgPage.getByRole('button', { name: 'Dismiss confirmation' }).click();
  await orgPage.screenshot({
    path: 'docs/screenshots/local-dashboard.png',
    fullPage: true,
  });
  await second.setViewportSize({ width: 390, height: 844 });
  await second.getByRole('link', { name: /^Events/ }).click();
  if (
    await second.getByRole('button', { name: 'Dismiss confirmation' }).count()
  )
    await second.getByRole('button', { name: 'Dismiss confirmation' }).click();
  assert(
    await second.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    'Mobile layout overflowed horizontally',
  );
  await second.screenshot({
    path: 'docs/screenshots/local-mobile-events.png',
    fullPage: true,
  });
  console.log(
    'PASS: desktop and mobile rendering; screenshots saved from actual local data.',
  );
  await second.getByRole('link', { name: 'Account', exact: true }).click();
  await second.getByRole('heading', { name: 'Your account.' }).waitFor();
  await orgPage.getByRole('button', { name: 'Sign out' }).click();
  await orgPage.getByRole('button', { name: 'Sign in', exact: true }).waitFor();
  assert.deepEqual(failures, [], 'Browser runtime errors');
  console.log(
    'PASS: account page and session logout. No browser runtime errors.',
  );
} finally {
  await browser?.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  store.close();
  rmSync(dir, { recursive: true, force: true });
}
