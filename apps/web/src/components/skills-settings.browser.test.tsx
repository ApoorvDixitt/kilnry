// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SkillsSettings } from './skills-settings';

let root: Root | undefined;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

const SKILLS = [
  {
    name: 'kilnry-ugc-ad',
    description: 'Ship a UGC ad. Use when the user wants an ad.',
    license: 'CC-BY-4.0',
    source: 'bundled' as const,
    enabled: true,
    tags: [],
  },
  {
    name: 'acme-helper',
    description: 'A community skill. Use when a test needs one.',
    license: 'MIT',
    source: 'installed' as const,
    enabled: true,
    tags: [],
  },
];

async function render(): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<SkillsSettings />);
    await Promise.resolve();
  });
  return host;
}

describe('SkillsSettings (F-SKL-04, F-SET-06)', () => {
  it('lists shipped and installed skills with their source', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(Response.json({ skills: SKILLS }))),
    );
    const host = await render();
    await act(async () => {
      await Promise.resolve();
    });
    expect(host.textContent).toContain('kilnry-ugc-ad');
    expect(host.textContent).toContain('acme-helper');
    expect(host.textContent).toContain('Shipped with Kilnry');
    expect(host.textContent).toContain('Community');
  });

  it('disables a skill through the skill route', async () => {
    const patches: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === 'PATCH') {
          patches.push({ url, body: JSON.parse(String(init.body)) });
          return Promise.resolve(Response.json({ ok: true }));
        }
        return Promise.resolve(Response.json({ skills: SKILLS }));
      }),
    );
    const host = await render();
    await act(async () => {
      await Promise.resolve();
    });
    const toggle = host.querySelector<HTMLInputElement>('.skills-toggle input');
    expect(toggle).toBeTruthy();
    await act(async () => {
      toggle!.click();
      await Promise.resolve();
    });
    expect(patches).toHaveLength(1);
    expect(patches[0]!.url).toContain('/api/skills/kilnry-ugc-ad');
    expect(patches[0]!.body).toEqual({ enabled: false });
  });

  it('installs a skill from a URL through the install route', async () => {
    const posts: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === 'POST') {
          posts.push({ url, body: JSON.parse(String(init.body)) });
          return Promise.resolve(Response.json({ ok: true, name: 'acme-helper' }));
        }
        return Promise.resolve(Response.json({ skills: SKILLS }));
      }),
    );
    const host = await render();
    await act(async () => {
      await Promise.resolve();
    });
    const input = host.querySelector<HTMLInputElement>('#skill-url')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(input, 'https://example.com/SKILL.md');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await Promise.resolve();
    });
    const button = [...host.querySelectorAll('button')].find((element) => element.textContent === 'Install')!;
    await act(async () => {
      button.click();
      await Promise.resolve();
    });
    expect(posts).toHaveLength(1);
    expect(posts[0]!.url).toContain('/api/skills/install');
    expect(posts[0]!.body).toEqual({ url: 'https://example.com/SKILL.md' });
  });

  it('installs a chosen folder by posting its files to the install route (F-SKL-03)', async () => {
    const posts: Array<{ url: string; body: { files?: Array<{ path: string; content: string }> } }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === 'POST') {
          posts.push({ url, body: JSON.parse(String(init.body)) });
          return Promise.resolve(Response.json({ ok: true, name: 'acme-helper' }));
        }
        return Promise.resolve(Response.json({ skills: SKILLS }));
      }),
    );
    const host = await render();
    await act(async () => {
      await Promise.resolve();
    });
    // A chosen folder: SKILL.md carries a webkitRelativePath under the folder.
    const skillMd = new File(['---\nname: acme-helper\n---\nbody'], 'SKILL.md');
    Object.defineProperty(skillMd, 'webkitRelativePath', { value: 'acme-helper/SKILL.md' });
    const fileInput = host.querySelector<HTMLInputElement>('.skills-dropzone-input')!;
    Object.defineProperty(fileInput, 'files', { value: [skillMd], configurable: true });
    await act(async () => {
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      // installFromFiles awaits file.text() and the install fetch; give both time.
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(posts).toHaveLength(1);
    expect(posts[0]!.url).toContain('/api/skills/install');
    // The top folder name is stripped so SKILL.md lands at the skill root.
    expect(posts[0]!.body.files?.[0]?.path).toBe('SKILL.md');
    expect(posts[0]!.body.files?.[0]?.content).toContain('name: acme-helper');
  });

  it('edits a community skill body and Saves through the re-validating route (F-SKL-04)', async () => {
    const posts: Array<{ url: string; body: { files?: Array<{ path: string; content: string }> } }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === 'POST') {
          posts.push({ url, body: JSON.parse(String(init.body)) });
          return Promise.resolve(Response.json({ ok: true, name: 'acme-helper' }));
        }
        if (url.includes('/api/skills/acme-helper') && !init?.method) {
          return Promise.resolve(
            Response.json({ skill: { name: 'acme-helper', body_markdown: '# acme-helper\nold body' } }),
          );
        }
        return Promise.resolve(Response.json({ skills: SKILLS }));
      }),
    );
    const host = await render();
    await act(async () => {
      await Promise.resolve();
    });
    // Open the community skill's preview (it is editable), edit and save.
    const previewButtons = [...host.querySelectorAll('button')].filter((b) => b.textContent === 'Preview');
    // The second row (acme-helper) is the community skill.
    await act(async () => {
      previewButtons[1]!.click();
      await Promise.resolve();
    });
    const editButton = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Edit')!;
    expect(editButton).toBeTruthy();
    await act(async () => {
      editButton.click();
      await Promise.resolve();
    });
    const textarea = host.querySelector<HTMLTextAreaElement>('.skills-edit-body')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(textarea, '# acme-helper\nnew body');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      await Promise.resolve();
    });
    const saveButton = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Save')!;
    await act(async () => {
      saveButton.click();
      await Promise.resolve();
    });
    expect(posts).toHaveLength(1);
    expect(posts[0]!.url).toContain('/api/skills/install');
    expect(posts[0]!.body.files?.[0]?.path).toBe('SKILL.md');
    expect(posts[0]!.body.files?.[0]?.content).toContain('new body');
  });
});
