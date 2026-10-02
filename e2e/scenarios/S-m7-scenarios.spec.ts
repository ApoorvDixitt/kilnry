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

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const root = process.cwd();
const dataDir = join(root, '.dev', 'e2e-data');
const EMAIL = 'owner@example.test';
const PASSWORD = 'Kilnry-local-test-42!';
const HOST_PORT = '127.0.0.1:3123';
// Constructed, well-shaped keys the adapters' detectors accept; never real.
const FAL_KEY = ['00000000-0000-4000-8000-000000000000', ':', '0'.repeat(32)].join('');
const OPENROUTER_KEY = ['sk-or-v1-', '0'.repeat(64)].join('');
const POLLINATIONS_KEY = `sk_${'p'.repeat(32)}`;

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
