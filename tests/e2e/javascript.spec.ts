import { test, expect, type Page } from '@playwright/test';

/**
 * P2 JavaScript browser smoke (spec §12): the paste paths that unit tests
 * cannot see — detection copy, grammar load over HTTP, and the diagram the
 * real worker derives. `/demo` needs no auth, so this runs anywhere the
 * dev server runs.
 */

const JS_ARROW = `const binarySearch = (arr, target) => {
  let lo = 0;
  let hi = arr.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] === target) return mid;
    else if (arr[mid] < target) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
};
`;

const JS_CLASS = `class Search {
  static find(arr, target) {
    let lo = 0;
    let hi = arr.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid] === target) return mid;
      else if (arr[mid] < target) lo = mid + 1;
      else hi = mid - 1;
    }
    return -1;
  }
}
`;

const TS_ANNOTATED = `function add(a: number, b: number): number {
  return a + b;
}
`;

/** Paste through the real clipboard path so detection runs (not typing). */
async function paste(page: Page, text: string): Promise<void> {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate((t) => navigator.clipboard.writeText(t), text);
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('ControlOrMeta+V');
}

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(String(err)));
  // Stash on the page for the assertion at the end of each test.
  (page as unknown as { __errors: string[] }).__errors = errors;
  await page.goto('/demo');
  await expect(page.locator('.cf-node[data-kind="loop-header"]')).toBeVisible();
});

test.afterEach(async ({ page }) => {
  const errors = (page as unknown as { __errors: string[] }).__errors ?? [];
  expect(errors, `console errors: ${errors.join('\n')}`).toEqual([]);
});

test('paste an arrow function: detected as JavaScript and diagrammed', async ({ page }) => {
  await paste(page, JS_ARROW);
  await expect(page.locator('.wb__detected')).toHaveText(/Detected JavaScript/);
  await expect(page.locator('.cf-node[data-kind="loop-header"]')).toBeVisible();
  await expect(page.locator('.cf-node[data-kind="branch"]')).toHaveCount(2);
  await expect(page.locator('.cf-node[data-kind="return"]')).toHaveCount(2);
});

test('paste a class with a static method: same diagram, qualified function', async ({
  page,
}) => {
  await paste(page, JS_CLASS);
  await expect(page.locator('.wb__detected')).toHaveText(/Detected JavaScript/);
  await expect(page.locator('.cf-node[data-kind="loop-header"]')).toBeVisible();
  await expect(page.locator('.cf-node[data-kind="branch"]')).toHaveCount(2);
});

test('paste TypeScript annotations: never claimed as JavaScript (spec §7)', async ({
  page,
}) => {
  await paste(page, TS_ANNOTATED);
  // Detection stays silent — the conservative rule leaves the selection
  // unchanged rather than mislabeling. /demo starts on Python.
  await expect(page.locator('.wb__detected')).toHaveCount(0);
  await expect(page.locator('.wb__notice')).toHaveText(/Couldn't parse this as Python/);
});

test('an undetected paste clears a previous detection banner', async ({ page }) => {
  await paste(page, JS_ARROW);
  await expect(page.locator('.wb__detected')).toHaveText(/Detected JavaScript/);
  // Ambiguous text detects as nothing: the banner must go, not linger over
  // content it never described. The selected language stays put.
  await paste(page, 'x = 1\n');
  await expect(page.locator('.wb__detected')).toHaveCount(0);
  await expect(page.locator('.wb__language')).toHaveValue('javascript');
});
