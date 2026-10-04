// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The M7 acceptance scenarios from PRD-21, tagged @m7. They run after AS-01 has
// done the first-run flow so the local account and Library exist, and under the
// strict mock service worker so no real paid request is ever made. S-21 drives
// LAN access on, a login from a second browser context, the hostile-Host check
// and an MCP client connection; S-22 drives the recovery-kit restore after the
// master key is lost. Everything a user clicks is driven through the interface;
// direct fetch is used only to read observable server state (config, audit).
//
// Harness boundary (recorded honestly): the acceptance server binds to
// 127.0.0.1 and cannot restart itself or bind a real LAN interface inside the
// single-worker suite, so S-21 asserts the pre-restart observable state the
// user reaches by clicking (the confirm dialog copy, the written config, the
// restart-required status, the audit event) together with the Host-check 421,
// the second-context login and the MCP tools/list, which do not need the
// restart. The lock-icon tooltip that appears once KILNRY_LAN is live is
// covered by the security-settings and app-shell component contracts. S-22
// locks the key store through a harness-only hook (refused outside
// KILNRY_TEST_MSW and in release builds) that drops the cached master key as a
// boot with the keyring entry missing would, then drives the Providers banner.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const root = process.cwd();
const dataDir = join(root, '.dev', 'e2e-data');
const libraryRoot = join(root, '.dev', 'e2e-library');
const EMAIL = 'owner@example.test';
const PASSWORD = 'Kilnry-local-test-42!';
const HOST_PORT = '127.0.0.1:3123';
// Constructed, well-shaped keys the adapters' detectors accept; never real.
const FAL_KEY = ['00000000-0000-4000-8000-000000000000', ':', '0'.repeat(32)].join('');
const OPENROUTER_KEY = ['sk-or-v1-', '0'.repeat(64)].join('');
const POLLINATIONS_KEY = `sk_${'p'.repeat(32)}`;
const MINIMAX_KEY = ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiJraWxucnkifQ', '0'.repeat(43)].join('.');

async function ensureSignedIn(page: Page, path: string): Promise<void> {
  await page.goto(path);
  if (/\/login$/.test(page.url())) {
    await page.getByLabel('Email').fill(EMAIL);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL((url) => !/\/login$/.test(url.pathname), { timeout: 30_000 });
    await page.goto(path);
  }
}

async function csrf(page: Page): Promise<string> {
  return page.evaluate(() =>
    decodeURIComponent(
      document.cookie
        .split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith('kilnry_csrf='))
        ?.slice('kilnry_csrf='.length) ?? '',
    ),
  );
}

async function providerConnected(page: Page, id: string): Promise<boolean> {
  return page.evaluate(async (id) => {
    const response = await fetch('/api/providers');
    if (!response.ok) return false;
    const body = (await response.json()) as { providers: Array<{ id: string; connected: boolean }> };
    return body.providers.some((provider) => provider.id === id && provider.connected);
  }, id);
}

async function ensureProvider(page: Page, id: string, key: string): Promise<void> {
  await ensureSignedIn(page, '/settings/providers');
  if (await providerConnected(page, id)) return;
  const token = await csrf(page);
  await page.evaluate(
    async ({ token, id, key }) => {
      await fetch(`/api/providers/${id}/key`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Kilnry-CSRF': token },
        body: JSON.stringify({ key, accept_tos: false }),
      });
    },
    { token, id, key },
  );
  await expect.poll(() => providerConnected(page, id), { timeout: 15_000 }).toBe(true);
}

function readConfig(): { lan_enabled?: boolean; allowed_hosts?: string[] } {
  return JSON.parse(readFileSync(join(dataDir, 'config.json'), 'utf8')) as {
    lan_enabled?: boolean;
    allowed_hosts?: string[];
  };
}

test('@m7 S-21 LAN access on, login from another device, Host check', async ({ browser, page, request }) => {
  await ensureSignedIn(page, '/settings/security');
  await expect(page.getByRole('heading', { name: 'LAN access' })).toBeVisible();

  // The user toggles "Allow access from my network" and reads the confirm.
  await page.getByRole('button', { name: 'Allow access from my network' }).click();
  const dialog = page.getByRole('dialog', { name: 'Allow access from your network?' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Allow access from your network?' })).toBeVisible();
  await expect(dialog).toContainText("Don't do this on a café or shared Wi-Fi.");

  // Adds the LAN IP to allowed hosts, confirms the password, clicks
  // "Turn on and restart".
  const lanIp = '192.168.7.42';
  await dialog.getByLabel("Allowed hosts (your machine's LAN address)").fill(lanIp);
  await dialog.getByLabel('Current password for LAN access change').fill(PASSWORD);
  await dialog.getByRole('button', { name: 'Turn on and restart' }).click();
  await expect(dialog).toBeHidden();

  // The change is written: LAN access is configured with the acknowledged host
  // and the page shows it is pending a restart. (The server cannot restart in
  // this harness; the pending state is what the user sees before it does.)
  await expect(
    page.getByText('LAN access will turn on after Kilnry restarts.', { exact: false }),
  ).toBeVisible();
  await expect.poll(() => readConfig().lan_enabled).toBe(true);
  expect(readConfig().allowed_hosts).toContain(lanIp);

  // The hostile Host header is rejected with 421 Misdirected Request.
  const evil = await request.get('/', { headers: { Host: 'evil.example' } });
  expect(evil.status()).toBe(421);

  // An MCP client connects with a valid token and tools/list succeeds. Mint a
  // token through the interface the same way the client matrix does.
  await page.goto('/settings/mcp');
  await expect(page.getByRole('heading', { name: 'Model Context Protocol', exact: false })).toBeVisible();
  const token = await page.evaluate(async () => {
    const csrf = decodeURIComponent(
      document.cookie
        .split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith('kilnry_csrf='))
        ?.slice('kilnry_csrf='.length) ?? '',
    );
    const minted = await fetch('/api/mcp/tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Kilnry-CSRF': csrf },
      body: JSON.stringify({ name: 's21-lan', scope: 'full' }),
    });
    return ((await minted.json()) as { token: string }).token;
  });
  expect(token.length).toBeGreaterThan(0);
  const toolsList = await request.post('/mcp', {
    headers: {
      Host: HOST_PORT,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
  });
  expect(toolsList.ok()).toBe(true);
  const toolsText = await toolsList.text();
  expect(toolsText).toContain('kilnry_generate');

  // The audit log records lan.enabled, asserted through the Security page.
  await page.goto('/settings/security');
  await expect(page.locator('.audit-table [data-action="lan.enabled"]').first()).toBeVisible();

  // A second browser context — another device — opens the app and sees the
  // login page (no first-run token), then after login reaches Create.
  const secondDevice = await browser.newContext();
  const secondPage = await secondDevice.newPage();
  await secondPage.goto(`http://${HOST_PORT}/create`);
  await expect(secondPage).toHaveURL(/\/login$/);
  await secondPage.getByLabel('Email').fill(EMAIL);
  await secondPage.getByLabel('Password').fill(PASSWORD);
  await secondPage.getByRole('button', { name: 'Sign in' }).click();
  await expect(secondPage).toHaveURL(/\/create$/);
  await expect(secondPage.getByRole('heading', { name: 'Create', exact: true })).toBeVisible();
  await secondDevice.close();

  // Leave LAN access off so a later scenario starts from a known state.
  await page.goto('/settings/security');
  await page.getByLabel('Current password for LAN access change').fill(PASSWORD);
  await page.getByRole('button', { name: 'Disable after restart' }).click();
  await expect.poll(() => readConfig().lan_enabled).toBe(false);
});

test('@m7 S-22 recovery kit restores keys after keychain loss', async ({ page }) => {
  // Given an onboarded install with provider keys and the recovery kit viewed.
  // AS-01 connected OpenRouter and viewed the kit; connect fal and Pollinations
  // too so three provider keys exist, all protected by the same master key.
  await ensureSignedIn(page, '/settings/providers');
  await ensureProvider(page, 'openrouter', OPENROUTER_KEY);
  await ensureProvider(page, 'fal', FAL_KEY);
  await ensureProvider(page, 'pollinations', POLLINATIONS_KEY);

  // View the recovery kit on the Security page and capture the kit string and
  // the checksum words, exactly as the harness does in the Given.
  await page.goto('/settings/security');
  await page.getByLabel('Current password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'View recovery kit' }).click();
  await expect(page.locator('.recovery-card code')).toContainText('kilnry1');
  const kit = ((await page.locator('.recovery-card code').textContent()) ?? '').trim();
  expect(kit.length).toBeGreaterThan(20);
  const status = await page.evaluate(async () => {
    const response = await fetch('/api/security/key-store');
    return (await response.json()) as { status?: { checksum_words?: string } };
  });
  const checksumWords = status.status?.checksum_words ?? '';
  expect(checksumWords.split(' ')).toHaveLength(4);

  // The harness loses the master key: it drops the cached key and locks the
  // store exactly as a boot with the keyring entry (or KILNRY_MASTER_KEY file)
  // missing does. This harness-only hook is refused outside KILNRY_TEST_MSW and
  // in release builds; it stands in for deleting the entry and restarting.
  const lost = await page.evaluate(
    async (token) => {
      const response = await fetch('/api/security/key-store', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Kilnry-CSRF': token },
        body: JSON.stringify({ action: 'simulate_key_loss' }),
      });
      return (await response.json()) as { ok?: boolean; status?: { locked?: boolean } };
    },
    await csrf(page),
  );
  expect(lost.status?.locked).toBe(true);

  // The user opens Settings › Providers and sees the locked banner.
  await page.goto('/settings/providers');
  const banner = page.locator('.provider-locked');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText(
    "Your provider keys are encrypted but the master key is missing from this machine's keychain.",
  );
  const kitField = banner.getByLabel('Enter recovery kit');
  await expect(kitField).toBeVisible();

  // A well-formed kit for a different key is rejected with the checksum words
  // of the key this installation expects — the words captured above.
  await kitField.fill(wrongKit());
  await banner.getByRole('button', { name: 'Restore keys' }).click();
  await expect(banner).toContainText(`That kit doesn't match. Check the checksum words: ${checksumWords}.`);

  // The correct kit restores the keys without re-entry; the banner goes away.
  await kitField.fill(kit);
  await banner.getByRole('button', { name: 'Restore keys' }).click();
  await expect(banner).toBeHidden();
  await expect(page.getByText('Keys restored. Test each provider to confirm.')).toBeVisible();

  // Each provider's Test passes and its card shows "Connected".
  for (const name of ['OpenRouter', 'fal', 'Pollinations']) {
    const card = page.locator('.provider-card').filter({ has: page.getByRole('heading', { name }) });
    await card.getByRole('button', { name: 'Test' }).click();
    await expect(page.getByText(/Connection passed · \d+ ms/)).toBeVisible({ timeout: 15_000 });
    await expect(card.locator('.provider-status')).toHaveText('Connected');
  }

  // The audit log records recovery_kit.used, asserted on the Security page.
  await page.goto('/settings/security');
  await expect(page.locator('.audit-table [data-action="recovery_kit.used"]').first()).toBeVisible();
});

// A syntactically valid recovery kit (bech32m, version byte 1, 32-byte key) for
// a key that is not this installation's, so the restore reaches the fingerprint
// comparison and answers with the checksum words rather than a format error.
function wrongKit(): string {
  const alphabet = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
  const hrp = 'kilnry';
  const polymod = (values: number[]): number => {
    const generators = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
    let checksum = 1;
    for (const value of values) {
      const top = checksum >>> 25;
      checksum = ((checksum & 0x1ffffff) << 5) ^ value;
      for (let index = 0; index < 5; index += 1) if ((top >>> index) & 1) checksum ^= generators[index]!;
    }
    return checksum >>> 0;
  };
  const expanded = [...hrp]
    .map((c) => c.charCodeAt(0) >>> 5)
    .concat(0, ...[...hrp].map((c) => c.charCodeAt(0) & 31));
  const bytes = [1, ...Array.from({ length: 32 }, (_, index) => (index * 37 + 11) & 0xff)];
  const data: number[] = [];
  let accumulator = 0;
  let bits = 0;
  for (const byte of bytes) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      data.push((accumulator >>> bits) & 31);
    }
  }
  if (bits > 0) data.push((accumulator << (5 - bits)) & 31);
  const value = polymod([...expanded, ...data, 0, 0, 0, 0, 0, 0]) ^ 0x2bc830a3;
  const checksum = Array.from({ length: 6 }, (_, index) => (value >>> (5 * (5 - index))) & 31);
  return `${hrp}1${[...data, ...checksum].map((index) => alphabet[index]).join('')}`;
}

// The most recently created job, as the Jobs route reports it.
async function latestJob(page: Page): Promise<Record<string, unknown> | undefined> {
  return page.evaluate(async () => {
    const response = await fetch('/api/jobs');
    if (!response.ok) return undefined;
    const body = (await response.json()) as { jobs: Array<Record<string, unknown>> };
    return body.jobs[0];
  });
}

// Spend-ledger rows written for one job, read from the owner's CSV export.
async function ledgerRows(page: Page, jobId: string): Promise<number> {
  const token = await csrf(page);
  return page.evaluate(
    async ({ token, jobId }) => {
      const response = await fetch('/api/budget/ledger/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Kilnry-CSRF': token },
        body: JSON.stringify({ from: '2000-01-01T00:00:00.000Z', to: '2100-01-01T00:00:00.000Z' }),
      });
      if (!response.ok) return -1;
      const body = (await response.json()) as { csv?: string };
      return (body.csv ?? '').split('\n').filter((line) => line.includes(jobId)).length;
    },
    { token, jobId },
  );
}

// Generate one image on Create through the composer and open Transforms on its
// result tile, as a user turning a still into something else would.
async function generateAndOpenTransforms(page: Page, prompt: string): Promise<string> {
  await page.goto('/create');
  await page.getByRole('textbox', { name: 'Describe what you want to make…' }).fill(prompt);
  await expect(page.locator('.cost-strip .cost-strip-figure')).toContainText('$', { timeout: 15_000 });
  await page.locator('.composer').getByRole('button', { name: 'Generate' }).click();
  const tile = page.locator('.result-tile img').first();
  await expect(tile).toBeVisible({ timeout: 60_000 });
  const src = (await tile.getAttribute('src')) ?? '';
  const assetId = decodeURIComponent(src.replace('/api/media/', ''));
  expect(assetId).not.toBe('');
  await page.locator('.result-tile-transform').first().click();
  await page.locator('.transforms-panel').getByRole('tab', { name: 'Image → 3D' }).click();
  return assetId;
}

test('@m7 F-CRE-15 image to 3D on Create: connect fal, price, GLB tile, sidecar, ledger', async ({
  page,
}) => {
  test.setTimeout(240_000);
  // Given a provider that can make the source still, and fal disconnected so
  // the 3D tab shows its connect state.
  await ensureProvider(page, 'pollinations', POLLINATIONS_KEY);
  await ensureProvider(page, 'fal', FAL_KEY);
  await page.goto('/settings/providers');
  const falCard = page.locator('.provider-card').filter({ has: page.getByRole('heading', { name: 'fal' }) });
  await falCard.getByRole('button', { name: 'Remove' }).click();
  await expect(falCard.locator('.provider-status')).toHaveText('Not connected');

  // Without a fal key the Image → 3D tab says so and offers Connect fal.
  await generateAndOpenTransforms(page, 'a ceramic teapot, studio cut-out');
  const panel = page.locator('.transforms-panel');
  await expect(panel.locator('.transforms-needs-key')).toContainText('3D needs a fal key.');
  await expect(panel.locator('.transforms-run')).toBeDisabled();
  await panel.getByRole('link', { name: 'Connect fal' }).click();
  await expect(page).toHaveURL(/\/settings\/providers$/);

  // The user connects fal on Providers.
  await page.getByLabel('Add or replace a provider key').fill(FAL_KEY);
  await page.getByLabel('Provider', { exact: true }).selectOption('fal');
  await page.getByRole('button', { name: 'Test and save' }).click();
  await expect(falCard.locator('.provider-status')).toHaveText('Connected', { timeout: 15_000 });

  // Back on Create: a fresh still, then Image → 3D prices both models.
  const sourceId = await generateAndOpenTransforms(page, 'a ceramic teapot, studio cut-out');
  await expect(panel.locator('.transforms-cost')).toHaveText('$0.02 · 1 model · ~40 s', { timeout: 15_000 });
  await panel.locator('.transforms-model3d').selectOption('hunyuan3d');
  await expect(panel.locator('.transforms-cost')).toContainText('$0.375 · 1 model');
  await panel.locator('.transforms-model3d').selectOption('trellis');
  await expect(panel.locator('.transforms-cost')).toHaveText('$0.02 · 1 model · ~40 s');
  await expect(panel.locator('.transforms-run')).toHaveText('Run · $0.02');
  await panel.locator('.transforms-run').click();
  await expect(panel).toBeHidden();

  // The 3D result appears as a GLB viewer tile that draws the model with its
  // wireframe toggle.
  const viewer = page.locator('.result-tile .glb-viewer').first();
  await expect(viewer).toHaveAttribute('data-viewer', 'webgl', { timeout: 90_000 });
  await expect(viewer.locator('canvas')).toBeVisible();
  const wireframe = viewer.getByRole('button', { name: 'Wireframe' });
  await wireframe.click();
  await expect(wireframe).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.result-tile figcaption').first()).toContainText('$0.02');

  // The job ran on Trellis through the normal money path: one ledger row.
  const job = await latestJob(page);
  expect(job?.status).toBe('completed');
  expect(job?.modelId).toBe('fal-ai/trellis');
  expect(await ledgerRows(page, String(job?.id))).toBe(1);

  // The GLB is a Library asset next to its source, with a kind 3d sidecar whose
  // lineage records the still it was made from.
  const glbId = (job?.outputAssetIds as string[] | undefined)?.[0] ?? '';
  expect(glbId).not.toBe('');
  const assets = await page.evaluate(async () => {
    const response = await fetch('/api/library/assets?sort=newest');
    return ((await response.json()) as { assets?: Array<{ id: string; path: string }> }).assets ?? [];
  });
  const glbPath = assets.find((asset) => asset.id === glbId)?.path ?? '';
  const sourcePath = assets.find((asset) => asset.id === sourceId)?.path ?? '';
  expect(glbPath).toMatch(/\.glb$/);
  expect(dirname(glbPath)).toBe(dirname(sourcePath));
  const absolute = join(libraryRoot, glbPath);
  expect(readFileSync(absolute).subarray(0, 4).toString('ascii')).toBe('glTF');
  const sidecar = JSON.parse(readFileSync(`${absolute}.kilnry.json`, 'utf8')) as {
    kind?: string;
    lineage?: { made_from?: string[] };
  };
  expect(sidecar.kind).toBe('3d');
  expect(sidecar.lineage?.made_from).toEqual([sourceId]);
});

// Create a Character with one anchor reference image (Given setup).
async function characterWithReference(page: Page, handle: string, assetId: string): Promise<void> {
  const token = await csrf(page);
  const statuses = await page.evaluate(
    async ({ token, handle, assetId }) => {
      const post = (body: Record<string, unknown>) =>
        fetch('/api/characters/manage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Kilnry-CSRF': token },
          body: JSON.stringify(body),
        }).then((response) => response.status);
      const created = await post({ action: 'create', handle, kind: 'character', display_name: handle });
      const referenced = await post({
        action: 'add_references',
        handle,
        references: [{ asset_id: assetId, role: 'anchor' }],
      });
      return { created, referenced };
    },
    { token, handle, assetId },
  );
  expect(statuses).toEqual({ created: 200, referenced: 200 });
}

async function assetPath(page: Page, assetId: string): Promise<string> {
  return page.evaluate(async (assetId) => {
    const response = await fetch(`/api/library/asset/${encodeURIComponent(assetId)}`);
    return ((await response.json()) as { asset?: { path?: string } }).asset?.path ?? '';
  }, assetId);
}

async function generateOnCreate(page: Page, prompt: string): Promise<string> {
  await page.goto('/create');
  await page.getByRole('textbox', { name: 'Describe what you want to make…' }).fill(prompt);
  await expect(page.locator('.cost-strip .cost-strip-figure')).toContainText('$', { timeout: 15_000 });
  await page.locator('.composer').getByRole('button', { name: 'Generate' }).click();
  const tile = page.locator('.result-tile img').first();
  await expect(tile).toBeVisible({ timeout: 60_000 });
  return decodeURIComponent(((await tile.getAttribute('src')) ?? '').replace('/api/media/', ''));
}

test('@m7 F-CHR-12 consistency check: enable with its download, badge on outputs, off hides it', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await ensureProvider(page, 'pollinations', POLLINATIONS_KEY);
  // Given a Character with one reference photo.
  const referenceId = await generateOnCreate(page, 'studio portrait of a woman, soft window light');
  await characterWithReference(page, 'noor_m7', referenceId);

  // The check is off by default; Settings › Characters offers to enable it and
  // shows what it will download.
  await page.goto('/settings/characters');
  const setting = page.locator('.consistency-setting');
  await expect(setting.getByRole('heading', { name: 'Consistency check (local, free)' })).toBeVisible();
  await expect(setting).toContainText('Face check only. Stylised and non-human characters are not scored.');
  await expect(setting.locator('.consistency-size')).toContainText(
    'Downloads 391 MB once to ~/.kilnry/models',
  );
  await setting.getByRole('button', { name: 'Enable the consistency check' }).click();
  await expect(setting.locator('.consistency-ready')).toHaveText(
    'On · models verified · scoring runs on this machine',
    { timeout: 60_000 },
  );
  await expect(setting.getByRole('switch', { name: 'Consistency check (local, free)' })).toHaveAttribute(
    'aria-checked',
    'true',
  );

  // An image made with @noor_m7 is scored and badged in the Library.
  const outputId = await generateOnCreate(page, '@noor_m7 on a rooftop café at golden hour');
  const outputPath = await assetPath(page, outputId);
  const fileName = outputPath.split('/').at(-1) ?? '';
  expect(fileName).not.toBe('');
  await page.goto('/library');
  const tile = page.locator('.asset-tile-wrap').filter({ has: page.getByRole('button', { name: fileName }) });
  const badge = tile.locator('.consistency-badge');
  await expect(async () => {
    await page.reload();
    await expect(badge).toHaveText('High', { timeout: 3_000 });
  }).toPass({ timeout: 60_000 });
  await expect(badge).toHaveAttribute('title', /Looks like @noor_m7 · score \d\.\d\d/);

  // Provenance shows the same badge.
  await tile.getByRole('button', { name: fileName }).click();
  await page.getByRole('tab', { name: 'Provenance' }).click();
  await expect(page.locator('.inspector-facts .consistency-badge')).toHaveText('High');

  // The sidecar carries the badge summary only, never an embedding.
  const sidecarText = readFileSync(`${join(libraryRoot, outputPath)}.kilnry.json`, 'utf8');
  const sidecar = JSON.parse(sidecarText) as { consistency?: Record<string, unknown> };
  expect(sidecar.consistency).toMatchObject({ model: 'auraface-v1', character: '@noor_m7', badge: 'high' });
  expect(Object.values(sidecar.consistency ?? {}).some((value) => Array.isArray(value))).toBe(false);
  expect(sidecarText).not.toContain('embedding');

  // Turning the check off hides the badge but keeps the stored score.
  await page.goto('/settings/characters');
  await page.getByRole('switch', { name: 'Consistency check (local, free)' }).click();
  await expect(page.getByRole('button', { name: 'Enable the consistency check' })).toBeVisible();
  await page.goto('/library');
  await expect(tile.getByRole('button', { name: fileName })).toBeVisible({ timeout: 30_000 });
  await expect(tile.locator('.consistency-badge')).toHaveCount(0);
  const kept = JSON.parse(readFileSync(`${join(libraryRoot, outputPath)}.kilnry.json`, 'utf8')) as {
    consistency?: { badge?: string };
  };
  expect(kept.consistency?.badge).toBe('high');
});

test('@m7 F-CHR-14 export a character to a bundle and import it back round-trips on disk', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await ensureProvider(page, 'pollinations', POLLINATIONS_KEY);
  // A character with one reference, built from a generated image.
  const media = await generateOnCreate(page, 'a calm ceramicist in a green apron, studio light');
  const assetId = media.split('/').pop()?.split('.')[0] ?? '';
  expect(assetId).not.toBe('');
  await characterWithReference(page, 'potter_m7', assetId);

  // Export through the UI (the clicked-control rule): open the dialog, confirm,
  // and read the bundle path from the status note. The dialog's two toggles
  // default off.
  await page.goto('/characters/potter_m7');
  await page.getByTestId('character-export').click();
  const dialog = page.getByRole('dialog', { name: 'Export character bundle' });
  await expect(dialog).toBeVisible();
  await page.getByTestId('character-export-confirm').click();
  const note = page.locator('.character-export-note');
  await expect(note).toContainText('.zip', { timeout: 30_000 });
  const noteText = (await note.textContent()) ?? '';
  const bundlePath = noteText.match(/(\/\S+\.zip)/)?.[1] ?? '';
  expect(bundlePath).not.toBe('');
  expect(existsSync(bundlePath)).toBe(true);

  // Import through the UI: the file picker on the Characters tab. A handle clash
  // lands as @potter_m7_2 and its card appears.
  await page.goto('/characters?tab=characters');
  await page.getByTestId('character-import').click();
  await page.locator('input[type="file"][accept=".zip"]').setInputFiles(bundlePath);
  await expect(page.locator('.characters-import-note')).toContainText('@potter_m7_2', { timeout: 30_000 });

  // The round-tripped character resolves with the same descriptor and one ref.
  const resolved = await page.evaluate(async () => {
    const r = await fetch('/api/characters/potter_m7_2');
    return (await r.json()) as {
      item?: { display_name?: string; references?: Array<{ asset_id?: string }> };
    };
  });
  expect(resolved.item?.display_name).toBe('potter_m7');
  expect(resolved.item?.references ?? []).toHaveLength(1);

  // Item 1: the imported reference is a FRESH asset id, and the exporter's
  // original asset was NOT re-pointed — its row still names the Create output.
  const importedAssetId = resolved.item?.references?.[0]?.asset_id ?? '';
  expect(importedAssetId).not.toBe('');
  expect(importedAssetId).not.toBe(assetId);
  const originalPath = await assetPath(page, assetId);
  expect(originalPath.startsWith('Characters/@potter_m7_2/')).toBe(false);
  const importedPath = await assetPath(page, importedAssetId);
  expect(importedPath.startsWith('Characters/@potter_m7_2/imported/')).toBe(true);
  expect(existsSync(join(libraryRoot, importedPath))).toBe(true);
});

async function ledgerRowsByKind(page: Page, kind: string): Promise<number> {
  const token = await csrf(page);
  return page.evaluate(
    async ({ token, kind }) => {
      const response = await fetch('/api/budget/ledger/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Kilnry-CSRF': token },
        body: JSON.stringify({ from: '2000-01-01T00:00:00.000Z', to: '2100-01-01T00:00:00.000Z' }),
      });
      if (!response.ok) return -1;
      const body = (await response.json()) as { csv?: string };
      const lines = (body.csv ?? '')
        .split('\n')
        .slice(1)
        .filter((line) => line.trim() !== '');
      return lines.filter((line) => line.split(',')[5] === kind).length;
    },
    { token, kind },
  );
}

test('@m7 F-VOI-03 design a voice: connect MiniMax, price shown, one ledger row, bindable', async ({
  page,
}) => {
  test.setTimeout(240_000);
  // Connect-MiniMax state: with no MiniMax or fal key, the Voices tab shows no
  // Design voice control.
  await ensureSignedIn(page, '/characters?tab=voices');
  await expect(page.getByTestId('voices-tab')).toBeVisible();
  await expect(page.getByTestId('voice-design-open')).toHaveCount(0);

  // Connect MiniMax; the Design voice control appears.
  await ensureProvider(page, 'minimax', MINIMAX_KEY);
  await page.goto('/characters?tab=voices');
  await expect(page.getByTestId('voice-design-open')).toBeVisible();

  // A fictional Character to bind the designed voice to.
  const token = await csrf(page);
  await page.evaluate(async (token) => {
    await fetch('/api/characters/manage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Kilnry-CSRF': token },
      body: JSON.stringify({
        action: 'create',
        kind: 'character',
        handle: 'narrator_m7',
        display_name: 'Narrator',
        is_real_person: false,
      }),
    });
  }, token);

  // Open the form, see the $3 price before submit, fill it, and design.
  await page.getByTestId('voice-design-open').click();
  await expect(page.getByTestId('voice-design-price')).toContainText('$3.00');
  await page.getByLabel('Name').fill('Warm Narrator');
  await page
    .getByLabel('Describe the voice (up to 300 characters)')
    .fill('A warm, low-pitched narrator in her forties, unhurried, with a slight smile in the voice.');
  await page.getByTestId('voice-design-submit').click();
  await expect(page.getByTestId('voice-design-note')).toContainText('bindable', { timeout: 30_000 });

  // Exactly one voice_clone ledger row (a designed voice bills as voice_clone),
  // and the designed voice is stored as a design, bindable like a clone.
  await expect.poll(() => ledgerRowsByKind(page, 'voice_clone'), { timeout: 10_000 }).toBe(1);
  const designed = await page.evaluate(async () => {
    const response = await fetch('/api/voices?type=clone');
    const body = (await response.json()) as {
      voices?: Array<{ name?: string; is_clone?: boolean }>;
    };
    return body.voices?.find((voice) => voice.name === 'Warm Narrator') ?? null;
  });
  expect(designed?.is_clone).toBe(true);

  // Bind it to the Character through the manage route (bindable like a clone).
  const bound = await page.evaluate(async (token) => {
    const list = await fetch('/api/voices?type=clone').then(
      (r) => r.json() as Promise<{ voices?: Array<{ name?: string; ulid?: string; id?: string }> }>,
    );
    const voice = list.voices?.find((v) => v.name === 'Warm Narrator');
    const ulid = voice?.ulid ?? voice?.id ?? '';
    const response = await fetch('/api/voices/manage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Kilnry-CSRF': token },
      body: JSON.stringify({ action: 'bind', handle: 'narrator_m7', voice_ulid: ulid }),
    });
    return response.ok;
  }, token);
  expect(bound).toBe(true);
});
