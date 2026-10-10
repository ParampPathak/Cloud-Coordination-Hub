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
  await orgPage.getByLabel('Options', { exact: true }).fill('Events\nPolls');
  await orgPage.getByRole('button', { name: 'Publish poll' }).click();
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
  await pollCard.getByRole('radio', { name: 'Events' }).check();
  await pollCard.getByRole('button', { name: 'Submit vote' }).click();
  await pollCard.getByText('Your vote is recorded').waitFor();
  console.log(
    'PASS: poll creation and authenticated voting through the browser.',
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
