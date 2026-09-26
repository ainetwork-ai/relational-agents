// Uses scripts/dev.sh on localhost:3110. All app APIs are mocked in the browser;
// no database, drive writes, wallet signatures or payment settlement occur.
import assert from 'node:assert/strict';
import { mkdir, copyFile, unlink, rmdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { ainuiFolder, ainuiPayment, toItem } from 'ain-ui';
const dir = fileURLToPath(new URL('../src/app/ainui-test-fixture/', import.meta.url));
await mkdir(dir); // Fail if somebody else owns this route; never overwrite it.
let browser, page;
const errors = [];
try {
  await copyFile(new URL('./fixtures/ainui-page.tsx', import.meta.url), `${dir}/page.tsx`);
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1100, height: 950 } });
  const requests = [];
  page.on('pageerror', e => errors.push(e.message));
  const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  const required = { x402Version: 2, accepts: [{ scheme: 'exact', network: 'eip155:8453', amount: '10000', asset: '0x0000000000000000000000000000000000000001', payTo: '0x0000000000000000000000000000000000000002', maxTimeoutSeconds: 300 }] };
  const paymentRequired = Buffer.from(JSON.stringify(required)).toString('base64');
  await page.route('**/api/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    requests.push({ path, method: req.method(), body: req.postDataJSON() });
    const json = body => route.fulfill({ json: body });
    if (path === '/api/aindrive/raw' || path === '/api/aindrive/thumb') return route.fulfill({ contentType: 'image/png', body: pixel });
    if (path === '/api/aindrive') return json({ configured: true, connected: true, account: { email: 'test@example.test' }, base: 'https://drive.test', drives: [{ id: 'drive1', name: 'Phone', root: '', online: true }] });
    if (path === '/api/aindrive/shared') return json({ folders: [] });
    if (path === '/api/aindrive/share') return req.method() === 'POST' ? json({}) : json({ connected: true, drives: [{ id: 'drive1', name: 'Phone', root: '', online: true, sharedIn: [] }], teamspaces: [{ id: 'team1', name: 'Family', workspaceName: 'Home', workspaceId: 'workspace1', members: 3 }] });
    if (path === '/api/ainui/aindrive') {
      const body = req.postDataJSON();
      assert.equal(body.mode, 'pick');
      return json({ messages: ainuiFolder({ driveId: 'drive1', path: '', items: [toItem('drive1', 'photos/a.jpg', { name: 'a.jpg', isDir: false }, {})], env: { canWrite: false, canDelete: false, view: 'grid' } }) });
    }
    if (path === '/api/gift/gift1/wallet') return json({ paymentRequired, messages: ainuiPayment({ shareToken: 'sale', title: 'Gift', required, paymentRequired, symbol: 'USDC', decimals: 6 }) });
    return json({});
  });
  await page.goto('http://localhost:3110/ainui-test-fixture', { waitUntil: 'networkidle', timeout: 60000 });
  await page.locator('#album .ain-ui button').click();
  await page.locator('[data-testid="album-lightbox-smoke"] .ain-ui img').waitFor();
  await page.keyboard.press('Escape');
  await page.locator('#file .ain-ui img').waitFor();
  await page.locator('#link input[type=text]').nth(0).fill('Shared notes');
  await page.locator('#link input[type=text]').nth(1).fill('notes');
  await page.locator('#link [data-testid="aindrive-link-form"] button').click();
  await page.waitForFunction(() => document.querySelector('#linked')?.textContent.includes('Shared notes'));
  assert.deepEqual(JSON.parse(await page.locator('#linked').textContent()), { driveId: 'drive1', root: 'notes', name: 'Shared notes' });
  await page.locator('#sharing [data-testid="aindrive-share-form"] button').click();
  assert.ok(requests.some(r => r.path === '/api/aindrive/share' && r.body?.teamspaceId === 'team1' && r.body?.driveIds?.[0] === 'drive1'));
  assert.match(await page.locator('#payment').innerText(), /0.01 USDC/);
  await page.locator('#payment').getByRole('button', { name: 'Pay 0.01 USDC', exact: true }).click();
  await page.locator('#payment [role=alert]').filter({ hasText: 'MetaMask' }).waitFor();
  assert.ok(!requests.some(r => r.path === '/api/gift/gift1/wallet' && r.method === 'POST'));
  await page.locator('#open-picker').click();
  await page.locator('[data-testid="aindrive-picker-list"] button').filter({ hasText: 'a.jpg' }).click();
  await page.waitForFunction(() => document.querySelector('#picked')?.textContent.includes('photos%2Fa.jpg'));
  assert.ok(!requests.some(r => r.path === '/api/ainui/aindrive' && /upload|delete|save/.test(r.body?.action?.name ?? '')));
  await page.screenshot({ path: '/tmp/ainui-integration.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.screenshot({ path: '/tmp/ainui-integration-mobile.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('AIN-UI browser checks passed: gallery, rich preview, form bindings, sharing, payment quote and read-only picker.');
} catch (e) {
  console.error(JSON.stringify({ errors, text: await page?.locator("body").innerText() }));
  await page?.screenshot({ path: "/tmp/ainui-failure.png", fullPage: true });
  throw e;
} finally {
  await browser?.close();
  await unlink(`${dir}/page.tsx`).catch(() => {});
  await rmdir(dir);
}
