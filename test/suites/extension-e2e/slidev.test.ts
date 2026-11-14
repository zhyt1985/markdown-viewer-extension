import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { launchExtensionContext } from '../../helpers/extension-e2e.ts';

test('installed Chrome extension opens a Slidev deck in its bundled shell', {
  skip: process.env.MV_SKIP_EXT_TESTS === '1', timeout: 60000,
}, async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'mv-slidev-'));
  const harness = await launchExtensionContext('slidev-ext-');
  try {
    const file = path.join(folder, 'demo.slides.md');
    await fs.writeFile(file, '---\ntheme: default\n---\n\n# First slide\n\n---\n\n# Second slide\n');
    const page = await harness.context.newPage();
    await page.goto(pathToFileURL(file).href);
    const frame = page.frameLocator('#slidev-frame');
    await frame.getByRole('heading', { name: 'First slide', exact: true }).first().waitFor({ timeout: 30000 });
    assert.equal(await frame.locator('body').evaluate(() => Boolean((window as Window & { __SLIDEV_THEME__?: unknown }).__SLIDEV_THEME__)), true);
    await frame.locator('body').press('ArrowRight');
    await frame.getByRole('heading', { name: 'Second slide', exact: true }).first().waitFor({ timeout: 15000 });
  } finally {
    await harness.close();
    await fs.rm(folder, { recursive: true, force: true });
  }
});
