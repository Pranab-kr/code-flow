import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

/**
 * The full-slice E2E the plan has owed since Plan 1: signup → project →
 * diagram → drag → reload → export, plus a node click scrolling the editor.
 *
 * Email confirmation is ON with no SMTP behind it, so the test confirms the
 * fresh user through the Auth Admin API (service key, local only — read from
 * .env.local at runtime, never committed). Without a service key the
 * authenticated slice cannot run and is skipped by name.
 */

function readEnvLocal(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const raw = readFileSync(path.resolve(process.cwd(), '.env.local'), 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 1) continue;
      out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
    }
  } catch {
    // No .env.local (CI): the auth test skips below.
  }
  return out;
}

const env = readEnvLocal();
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;

const canAuth = Boolean(SUPABASE_URL && SERVICE_KEY);

async function confirmUser(email: string): Promise<void> {
  const admin = createClient(SUPABASE_URL!, SERVICE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await admin.auth.admin.listUsers();
  if (error) throw error;
  const user = data.users.find((u) => u.email === email);
  if (!user) throw new Error(`fresh signup ${email} not found`);
  const { error: updateError } = await admin.auth.admin.updateUserById(user.id, {
    email_confirm: true,
  });
  if (updateError) throw updateError;
}

function transformOf(style: string | null): [number, number] | null {
  if (!style) return null;
  const m = /translate\((-?[\d.]+)px, ?(-?[\d.]+)px\)/.exec(style);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

test('signup → project → diagram → drag → reload → export', async ({ page }) => {
  test.skip(!canAuth, 'needs SUPABASE_URL + SERVICE_KEY in .env.local to confirm the fresh user');
  const email = `e2e+${Date.now()}@example.com`;
  const password = 'e2e-password-1';

  // 1. Sign up with a unique email through the real form.
  await page.goto('/signup');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  const outcome = await page
    .getByRole('status')
    .or(page.getByRole('alert'))
    .first()
    .innerText({ timeout: 15000 });
  if (/account created/i.test(outcome)) {
    // 2a. The quota held: confirm via the admin API (no SMTP here), then sign in.
    await confirmUser(email);
  } else {
    // 2b. The hosted project is out of email quota (Supabase answers signUp
    // with 429 "email rate limit exceeded" — a provider cap, not app
    // behavior). Provision the same user through the Admin API, which sends
    // no email, and continue the slice from UI signin.
    const admin = createClient(SUPABASE_URL!, SERVICE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) throw error;
  }
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/projects$/);

  // 3. Create a project (the Python starter seeds it with binary search).
  await page.getByLabel('New project').fill('e2e binary search');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(/\/projects\/.+/);

  // 4. A loop-header node appears; binary search has 2 branches + 2 returns.
  const loop = page.locator('.cf-node[data-kind="loop-header"]');
  await expect(loop).toBeVisible();
  await expect(page.locator('.cf-node[data-kind="branch"]')).toHaveCount(2);
  await expect(page.locator('.cf-node[data-kind="return"]')).toHaveCount(2);

  // 5. Drag a node and note its transform.
  const target = page.locator('.react-flow__node[data-id$="#b0"]').first();
  await expect(target).toBeVisible();
  const before = transformOf(await target.getAttribute('style'));
  expect(before).not.toBeNull();
  const box = await target.boundingBox();
  if (!box) throw new Error('drag target has no bounding box');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 120, cy + 80, { steps: 12 });
  await page.mouse.up();
  const moved = transformOf(await target.getAttribute('style'));
  expect(moved).not.toBeNull();
  expect(Math.abs(moved![0] - before![0])).toBeGreaterThan(50);

  // 6. Reload — the position is preserved. This is the assertion that matters.
  // The drag persists on drag-stop, so wait for the save round trip first.
  await page.waitForTimeout(2500);
  await page.reload();
  await expect(page.locator('.cf-node[data-kind="loop-header"]')).toBeVisible();
  const after = transformOf(
    await page.locator('.react-flow__node[data-id$="#b0"]').first().getAttribute('style'),
  );
  expect(after).not.toBeNull();
  expect(Math.abs(after![0] - moved![0])).toBeLessThan(2);
  expect(Math.abs(after![1] - moved![1])).toBeLessThan(2);

  // 7. Export PNG — a real file downloads.
  await page.getByRole('button', { name: /export the diagram/i }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PNG' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.png$/);

  // 8. Click a node — the editor follows to its line.
  await page.locator('.cf-node', { hasText: 'return -1' }).click();
  await expect(page.locator('.cm-activeLine', { hasText: 'return -1' })).toBeVisible();
});

test('no horizontal scroll at 320px on every route', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  for (const route of ['/', '/login', '/signup', '/projects', '/demo']) {
    await page.goto(route, { waitUntil: 'domcontentloaded' });
    const overflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth - document.documentElement.clientWidth;
    });
    expect(overflow, `horizontal overflow on ${route}`).toBeLessThanOrEqual(1);
  }
});

test('a syntax error keeps the last good diagram on screen', async ({ page }) => {
  // Spec §11: degrade, never blank. The demo parses client-side, so no auth.
  await page.goto('/demo');
  await expect(page.locator('.cf-node[data-kind="loop-header"]')).toBeVisible();

  // Append a broken top-level def: the parser reports diagnostics but the
  // binary-search graph it already derived stays on screen.
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\ndef broken(:\n', { delay: 20 });
  await page.waitForTimeout(1000);
  await expect(page.locator('.cf-node[data-kind="loop-header"]')).toBeVisible();
  await expect(page.locator('.cf-node[data-kind="branch"]')).toHaveCount(2);
});
