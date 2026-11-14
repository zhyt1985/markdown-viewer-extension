import { _electron } from 'playwright-core';

export function launchDesktop(options) {
  const args = options.args ?? [];
  return _electron.launch({
    ...options,
    args: args.some(arg => arg.startsWith('--lang=')) ? args : ['--lang=zh-CN', ...args],
  });
}

// Drive the real shell, including menus/dialogs, rather than bypassing UI actions.
export async function closeDialogs(page) {
  while (await page.locator('dialog[open]').count()) {
    const id=await page.locator('dialog[open]').first().getAttribute('id');
    await Promise.all([
      page.evaluate(id=>new Promise(resolve=>document.getElementById(id).addEventListener('close',()=>resolve(),{once:true})),id),
      page.locator('dialog[open] [data-shell-close]').first().click(),
    ]);
  }
}
export async function openFile(page) {
  await closeDialogs(page);
  await page.click('[data-shell-action="file-menu"]'); await page.click('#open');
}
export async function openWorkspace(page) {
  await closeDialogs(page);
  await page.click('[data-shell-action="file-menu"]'); await page.click('#open-workspace');
}
export async function exportFile(page, format) {
  await closeDialogs(page); await page.click('#export-open');
  await page.click(`[data-export-format="${format}"]`); await page.click('#export-start');
}
export async function cancelExport(page) {
  await closeDialogs(page); await page.click('#tasks-open'); await page.click('#cancel-export');
  await closeDialogs(page);
}
export async function openSettings(page) { await closeDialogs(page); await page.click('#settings-open'); }
export async function selectNav(page, name) { await closeDialogs(page); await page.locator(`.shell-activity [data-shell-nav="${name}"]`).click(); }
export async function documentMenu(page, id) { await closeDialogs(page); await page.click('[data-shell-action="document-menu"]'); await page.click(id); }
