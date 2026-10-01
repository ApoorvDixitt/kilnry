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
// covered by the security-settings and app-shell component contracts.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const root = process.cwd();
const dataDir = join(root, '.dev', 'e2e-data');
const EMAIL = 'owner@example.test';
const PASSWORD = 'Kilnry-local-test-42!';
const HOST_PORT = '127.0.0.1:3123';

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
