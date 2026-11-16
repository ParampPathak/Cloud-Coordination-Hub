import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { once } from 'node:events';
import { createApp } from '../dist/backend/backend/src/app.js';
import { readConfig } from '../dist/backend/backend/src/config.js';
import { createUser } from '../dist/backend/backend/src/auth.js';
import { SqliteStore } from '../dist/backend/backend/src/store.js';
import { planWorkspaceMigration } from '../dist/backend/backend/src/workspace-migration.js';

const port = 43813,
  origin = 'http://127.0.0.1:' + port;
const dir = 'artifacts/workspace-browser';
mkdirSync(dir, { recursive: true });
const store = new SqliteStore(':memory:');
const config = readConfig({
  NODE_ENV: 'test',
  APP_ORIGIN: origin,
  PORT: String(port),
  GUEST_DEMO_ENABLED: 'true',
});
const password = 'Fixture9-' + randomBytes(12).toString('hex'),
  email = 'workspace-organizer@example.test';
await createUser(store, email, 'Workspace Organizer', password, 'organizer');
const migration = planWorkspaceMigration(
  [{ kind: 'user', id: email, ...(await store.get('user', email)) }],
  email,
);
assert(await store.transact(migration.additions));
const server = createApp(config, store, false).listen(port, '127.0.0.1');
await once(server, 'listening');
let browser;
try {
  browser = await chromium.launch({
    executablePath:
      process.env.HUB_BROWSER_PATH ??
      (process.platform === 'win32'
        ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
        : '/usr/bin/google-chrome'),
    headless: true,
    args: ['--disable-background-networking'],
  });
  const contexts = await Promise.all([
    browser.newContext({ viewport: { width: 1440, height: 1000 } }),
    browser.newContext({ viewport: { width: 390, height: 844 } }),
  ]);
  const [org, guest] = await Promise.all(contexts.map((c) => c.newPage()));
  const errors = [];
  for (const p of [org, guest])
    p.on('pageerror', (e) => errors.push(e.message));
  const button = (p, name) =>
    p.getByRole('button', { name, exact: typeof name === 'string' });
  const click = (p, name) => button(p, name).click();
  const link = (p, name) =>
    p.getByRole('link', { name, exact: typeof name === 'string' }).click();
  const modal = (p) => p.getByRole('dialog');
  const modalButton = (p, name) =>
    modal(p).getByRole('button', { name, exact: true });
  const choose = async (p, current, next) => {
    await click(p, new RegExp('^' + current + ' '));
    await p
      .locator('.workspace-dropdown')
      .getByRole('button', { name: next, exact: true })
      .click();
    await button(p, new RegExp('^' + next + ' ')).waitFor();
  };
  const manage = async (p, name) => {
    await click(p, new RegExp('^' + name + ' '));
    await click(p, 'Manage Workspaces');
    await modal(p).waitFor();
  };
  async function create(name, current) {
    await manage(org, current);
    await modalButton(org, 'Create Workspace').click();
    await org.getByLabel('Workspace name').fill(name);
    await org.getByLabel('Organization or category').fill('Course fixtures');
    await modalButton(org, 'Create Workspace').click();
    await button(org, new RegExp('^' + name + ' ')).waitFor();
    await manage(org, name);
    await org.getByLabel('Current invitation code').waitFor();
    const code = await org.getByLabel('Current invitation code').inputValue();
    await click(org, 'Close dialog');
    return code;
  }
  await org.goto(origin);
  await org.getByLabel('Email address').fill(email);
  await org.getByLabel('Password', { exact: true }).fill(password);
  await click(org, 'Sign in');
  await button(org, /^Project workspace /).waitFor();
  const alpha = await create('Workshop Lab', 'Project workspace');
  const beta = await create('Cloud Classroom', 'Workshop Lab');
  await choose(org, 'Cloud Classroom', 'Workshop Lab');
  await link(org, /^Events/);
  await click(org, 'Create event');
  await org.getByLabel('Event title').fill('Cloud study groups');
  await org.getByLabel('Location or meeting link').fill('Room 204');
  const date = new Date(Date.now() + 5 * 86400e3);
  const localDate = new Date(+date - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
  await org.getByLabel('Date and time').fill(localDate);
  await org.getByText('Groups (optional)', { exact: true }).click();
  await org.getByLabel('Divide this event into groups').check();
  await modalButton(org, 'Create event').click();
  await org.getByRole('heading', { name: 'Cloud study groups' }).waitFor();
  await link(org, 'Polls');
  await click(org, 'Create poll');
  await org.getByLabel('Question', { exact: true }).fill('Which study topic?');
  await org.getByLabel('Option 1', { exact: true }).fill('Network design');
  await org.getByLabel('Option 2', { exact: true }).fill('Data storage');
  await modalButton(org, 'Create poll').click();
  await org.getByRole('heading', { name: 'Which study topic?' }).waitFor();
  await link(org, 'Scheduling');
  await click(org, 'Create time slot');
  await org.locator('input[name=title]').fill('Professor appointments');
  await org.getByLabel('Location or meeting link').fill('Room 108');
  await org.locator('input[type=datetime-local]').nth(0).fill(localDate);
  await org
    .locator('input[type=datetime-local]')
    .nth(1)
    .fill(
      new Date(+new Date(localDate) + 900000 - date.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16),
    );
  await modalButton(org, 'Create time slot').click();
  await org.getByRole('heading', { name: 'Professor appointments' }).waitFor();

  await guest.goto(origin);
  await click(guest, 'Join Classroom Demo');
  await guest.getByLabel('Display name').fill('Sam Fixture');
  await guest.getByLabel('Invitation code').fill(alpha);
  await click(guest, 'Find workspace');
  await guest.getByRole('status').getByText('Workshop Lab').waitFor();
  assert.equal(await guest.getByLabel('Email address').count(), 0);
  await click(guest, 'Join Workspace');
  await button(guest, /^Workshop Lab /).waitFor();
  await link(guest, /^Events/);
  await click(guest, 'Register');
  await click(guest, 'View groups');
  await click(guest, 'Join Group 3');
  await guest.getByText(/Your group: Group 3/).waitFor();
  await guest.screenshot({ path: dir + '/mobile-groups.png', fullPage: true });
  await button(guest, /^Workshop Lab /).click();
  await guest
    .locator('.workspace-dropdown')
    .getByRole('button', { name: 'Join Workspace' })
    .click();
  await guest.getByLabel('Invitation code').fill(beta);
  await modalButton(guest, 'Find workspace').click();
  await modal(guest).getByText('Cloud Classroom', { exact: true }).waitFor();
  await modalButton(guest, 'Join Workspace').click();
  await button(guest, /^Cloud Classroom /).waitFor();
  await guest
    .getByText('An organizer can create your workspace’s first event.')
    .waitFor();
  assert.equal(
    await guest.getByRole('heading', { name: 'Cloud study groups' }).count(),
    0,
  );
  await guest.reload();
  await button(guest, /^Cloud Classroom /).waitFor();
  await choose(guest, 'Cloud Classroom', 'Workshop Lab');
  await guest.getByRole('heading', { name: 'Cloud study groups' }).waitFor();
  await link(guest, 'Scheduling');
  await guest
    .getByLabel('Reason for meeting (optional)')
    .fill('Fixture question');
  await click(guest, 'Reserve slot');
  await guest.getByText('Your appointment', { exact: true }).waitFor();
  await click(guest, 'Cancel booking');
  await guest.getByText('Appointment cancelled.', { exact: true }).waitFor();
  await link(guest, 'Polls');
  await guest.getByRole('radio', { name: 'Network design' }).check();
  await click(guest, 'Submit vote');
  await guest.getByText('Your selection is recorded.').last().waitFor();
  assert.equal(await button(guest, 'Manage poll').count(), 0);
  await link(org, 'Polls');
  await click(org, 'Manage poll');
  org.once('dialog', (d) => d.dismiss());
  await click(org, 'Delete poll');
  await org.getByRole('heading', { name: 'Which study topic?' }).waitFor();
  org.once('dialog', (d) => d.accept());
  await click(org, 'Delete poll');
  await org.getByText('Poll deleted.', { exact: true }).waitFor();
  await org
    .getByRole('heading', { name: 'Which study topic?' })
    .waitFor({ state: 'hidden' });
  assert.equal(
    await org.getByRole('heading', { name: 'Which study topic?' }).count(),
    0,
  );
  await manage(org, 'Workshop Lab');
  await org.getByLabel('Current invitation code').waitFor();
  await org.screenshot({
    path: dir + '/desktop-workspace-management.png',
    mask: [org.getByLabel('Current invitation code')],
  });
  await click(org, 'Close dialog');
  await button(org, /^Workshop Lab /).click();
  await org.screenshot({ path: dir + '/desktop-workspace-switcher.png' });
  await button(guest, /^Workshop Lab /).click();
  const dropdown = guest.locator('.workspace-dropdown');
  await dropdown.waitFor();
  const box = await dropdown.boundingBox();
  assert(
    box.x >= 0 && box.x + box.width <= 390,
    'Mobile dropdown remains in viewport',
  );
  assert(
    await guest.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await guest.screenshot({ path: dir + '/mobile-workspace-switcher.png' });
  await guest.getByRole('link', { name: 'Account', exact: true }).click();
  await guest
    .locator('main')
    .getByRole('button', { name: 'Exit Demo', exact: true })
    .click();
  await button(guest, 'Join Classroom Demo').waitFor();
  assert.deepEqual(errors, []);
  console.log(
    'Real SQLite UI passed on desktop and mobile: create, invite confirmation, name-only guest, switch/reload, groups, booking, vote, cancel and confirm deletion, and Exit Demo.',
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
  store.close();
}
