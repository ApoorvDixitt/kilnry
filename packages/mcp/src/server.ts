// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The Model Context Protocol (MCP) server core (F-MCP-01). Builds one McpServer
// from a list of tool definitions, registers each tool, and serves a
// deterministic tools/list with the caching hint the specification locks in.
// The 20 tool implementations themselves live in @kilnry/core (one module per
// tool) so Chat and MCP share exactly one implementation (TRD-10 §2.9); this
// package only wires them onto the protocol.

import { McpServer, ResourceTemplate, createMcpHandler } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { toolAllowedForScope, type KilnryTool, type ToolServices } from '@kilnry/core';

export const MCP_SERVER_NAME = 'kilnry';

// tools/list and server/discover are cached by shared caches for five minutes
// (TRD-10 §1): 300000 ms.
export const TOOLS_LIST_TTL_MS = 300_000;

// The verbatim server instructions shipped to every client (TRD-10 §6, ≤ 1.5 KB).
export const MCP_INSTRUCTIONS = `Kilnry is a local AI media studio. Tools are grouped: discovery (kilnry_models, kilnry_estimate, kilnry_providers, kilnry_budget), creation (kilnry_generate, kilnry_transform, kilnry_ffmpeg, kilnry_analyze), library (kilnry_library, kilnry_library_manage, kilnry_import), reusable things (kilnry_characters, kilnry_characters_manage, kilnry_voices), templates (kilnry_presets, kilnry_workflows, kilnry_skills), and kilnry_jobs.
Rules: (1) Every generation costs the user real money. Call kilnry_estimate or read the estimate in the tool result, state the price in one line, and pass confirm_cost_usd only after the user agreed, unless the workspace is in Run-automatically mode. (2) Reference people and things with @handle; kilnry_characters resolve_prompt shows exactly what will be sent. (3) For anything multi-step (ads, explainers, sheets, thumbnails) call kilnry_skills list, then load ONE skill and follow it. (4) Use asset ids and paths, never bytes. Import URLs with kilnry_import. (5) Be concise: no raw JSON or bare ids in chat; show file paths and previews. (6) Never retry a submitted spend after a timeout; check kilnry_jobs first. (7) Reply in the user's language.`;

// The self-contained HTML for an MCP Apps widget (F-MCP-07, PRD-12 §8). It uses
// no external assets so it renders under the default CSP in a sandboxed iframe,
// and it is an MCP client over postMessage JSON-RPC 2.0 speaking exactly the
// MCP Apps specification (ext-apps specification/2026-01-26/apps.mdx):
//   • §Lifecycle 2 / §Standard MCP Messages: the View sends the `ui/initialize`
//     request, and after the host's result sends `ui/notifications/initialized`;
//   • §Notifications (Host → View): `ui/notifications/tool-input` carries the
//     tool arguments (the view name), `ui/notifications/tool-result` carries the
//     CallToolResult whose structuredContent the widget renders, and
//     `ui/notifications/tool-cancelled` ends the view with its reason;
//   • §Requests (View → Host): a picker returns its selection with
//     `ui/update-model-context` { structuredContent }, and Cancel is a standard
//     `tools/call` of kilnry_jobs (§Standard MCP Messages, host-gated).
// Nothing else is listened for. The three views:
//   • job_progress — a row per job with its cost and a Cancel button;
//   • asset_picker — a grid that returns { asset_ids: [...] };
//   • character_picker — cards that return { handles: ['@maya'] }.
// Text and structuredContent are complete without the widget, so a host without
// MCP Apps still shows something useful.
const UI_WIDGET_TITLES: Record<string, string> = {
  job_progress: 'Job progress',
  asset_picker: 'Pick an asset',
  character_picker: 'Pick a character',
};

export const MCP_APPS_PROTOCOL_VERSION = '2026-01-26';

export function uiWidgetHtml(view: string): string {
  const title = UI_WIDGET_TITLES[view] ?? 'Kilnry';
  const safeView = view.replace(/[^a-z_]/g, '');
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
  :root { color-scheme: light dark; font: 14px/1.5 system-ui, sans-serif; }
  body { margin: 0; padding: 16px; }
  h1 { font-size: 15px; margin: 0 0 8px; }
  .kilnry-widget-note { opacity: 0.7; }
  ul { list-style: none; margin: 0; padding: 0; }
  .kilnry-row { display: flex; align-items: center; gap: 12px; padding: 6px 0; border-bottom: 1px solid rgba(128,128,128,0.25); }
  .kilnry-row .name { flex: 1; }
  .kilnry-row .cost { opacity: 0.7; }
  button { font: inherit; cursor: pointer; }
  .kilnry-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .kilnry-card { padding: 8px; border: 1px solid rgba(128,128,128,0.35); border-radius: 6px; text-align: left; }
  .kilnry-card[aria-pressed="true"] { outline: 2px solid currentColor; }
</style>
</head>
<body>
  <main class="kilnry-widget" data-view="${safeView}">
    <h1 id="kilnry-title">${title}</h1>
    <div id="kilnry-root" data-testid="kilnry-widget-root" data-state="initializing">
      <p class="kilnry-widget-note">Loading…</p>
    </div>
  </main>
  <script>
  (function () {
    var TITLES = ${JSON.stringify(UI_WIDGET_TITLES)};
    var view = ${JSON.stringify(safeView)};
    var root = document.getElementById('kilnry-root');
    var titleEl = document.getElementById('kilnry-title');
    var nextId = 1;
    var INIT_ID = 0;
    var selectedAssets = [];
    var selectedHandles = [];

    // apps.mdx §Transport Layer: requests and notifications are JSON-RPC 2.0
    // posted to the parent; a request carries an id, a notification does not.
    function request(method, params) {
      var id = nextId++;
      window.parent.postMessage({ jsonrpc: '2.0', id: id, method: method, params: params }, '*');
      return id;
    }
    function notify(method, params) {
      window.parent.postMessage({ jsonrpc: '2.0', method: method, params: params }, '*');
    }

    function escapeHtml(value) {
      return String(value == null ? '' : value).replace(/[&<>"]/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
      });
    }
    function setView(next) {
      if (typeof next !== 'string' || !TITLES[next]) return;
      view = next;
      document.querySelector('.kilnry-widget').setAttribute('data-view', next);
      titleEl.textContent = TITLES[next];
    }

    function renderJobs(data) {
      var jobs = (data && data.jobs) || [];
      if (!jobs.length) { root.innerHTML = '<p class="kilnry-widget-note">No active jobs.</p>'; return; }
      var ul = document.createElement('ul');
      jobs.forEach(function (job) {
        var li = document.createElement('li');
        li.className = 'kilnry-row';
        li.setAttribute('data-testid', 'kilnry-job-row');
        var id = job.job_id || job.id;
        var cost = job.cost_usd != null ? job.cost_usd : job.actual_usd;
        var costText = cost != null ? ('$' + Number(cost).toFixed(2)) : '';
        li.innerHTML = '<span class="name">' + escapeHtml(job.label || job.model || id) + '</span>' +
          '<span class="cost">' + escapeHtml(costText) + '</span>';
        var cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.textContent = 'Cancel';
        cancel.setAttribute('data-testid', 'kilnry-job-cancel');
        cancel.addEventListener('click', function () {
          // apps.mdx §Standard MCP Messages: a View may call tools/call; the host
          // gates it and forwards it to the server (§Lifecycle 3 "Tool call").
          request('tools/call', { name: 'kilnry_jobs', arguments: { action: 'cancel', job_id: id } });
        });
        li.appendChild(cancel);
        ul.appendChild(li);
      });
      root.innerHTML = '';
      root.appendChild(ul);
    }

    // apps.mdx §Requests (View → Host) ui/update-model-context: the selection
    // goes to the model as structuredContent; each request overwrites the last.
    function publishSelection() {
      if (view === 'asset_picker') {
        request('ui/update-model-context', { structuredContent: { asset_ids: selectedAssets.slice() } });
      } else if (view === 'character_picker') {
        request('ui/update-model-context', { structuredContent: { handles: selectedHandles.slice() } });
      }
    }
    function toggle(list, value, card) {
      var at = list.indexOf(value);
      if (at === -1) list.push(value); else list.splice(at, 1);
      card.setAttribute('aria-pressed', at === -1 ? 'true' : 'false');
      publishSelection();
    }

    function renderAssets(data) {
      var assets = (data && data.assets) || [];
      var grid = document.createElement('div');
      grid.className = 'kilnry-grid';
      assets.forEach(function (asset) {
        var id = asset.asset_id || asset.id;
        var card = document.createElement('button');
        card.type = 'button';
        card.className = 'kilnry-card';
        card.setAttribute('data-testid', 'kilnry-asset-card');
        card.setAttribute('aria-pressed', 'false');
        card.textContent = asset.label || asset.path || id;
        card.addEventListener('click', function () { toggle(selectedAssets, id, card); });
        grid.appendChild(card);
      });
      root.innerHTML = '';
      root.appendChild(grid.children.length ? grid : document.createTextNode('No assets.'));
    }

    function renderCharacters(data) {
      var characters = (data && data.characters) || [];
      var grid = document.createElement('div');
      grid.className = 'kilnry-grid';
      characters.forEach(function (character) {
        var handle = '@' + String(character.handle || '').replace(/^@/, '');
        var card = document.createElement('button');
        card.type = 'button';
        card.className = 'kilnry-card';
        card.setAttribute('data-testid', 'kilnry-character-card');
        card.setAttribute('aria-pressed', 'false');
        card.textContent = handle;
        card.addEventListener('click', function () { toggle(selectedHandles, handle, card); });
        grid.appendChild(card);
      });
      root.innerHTML = '';
      root.appendChild(grid.children.length ? grid : document.createTextNode('No characters.'));
    }

    function render(data) {
      root.setAttribute('data-state', 'rendered');
      if (view === 'asset_picker') return renderAssets(data);
      if (view === 'character_picker') return renderCharacters(data);
      return renderJobs(data);
    }

    window.addEventListener('message', function (event) {
      var msg = event.data || {};
      if (msg.jsonrpc !== '2.0') return;
      // apps.mdx §Lifecycle 2: the ui/initialize result arrives, then the View
      // sends ui/notifications/initialized.
      if (msg.id === INIT_ID && (msg.result || msg.error)) {
        notify('ui/notifications/initialized', {});
        root.setAttribute('data-state', 'initialized');
        return;
      }
      // apps.mdx §Notifications (Host → View) ui/notifications/tool-input: the
      // complete tool arguments; kilnry_ui's view argument names what to render.
      if (msg.method === 'ui/notifications/tool-input') {
        var args = (msg.params && msg.params.arguments) || {};
        setView(args.view);
        return;
      }
      // apps.mdx §Notifications (Host → View) ui/notifications/tool-result: the
      // CallToolResult; structuredContent holds the rows (§Data Passing 2).
      if (msg.method === 'ui/notifications/tool-result') {
        var result = msg.params || {};
        var data = result.structuredContent;
        if (!data && Array.isArray(result.content)) {
          var text = result.content.filter(function (c) { return c && c.type === 'text'; })
            .map(function (c) { return c.text; }).join('');
          try { data = JSON.parse(text); } catch (_e) { data = {}; }
        }
        if (data && data.view) setView(data.view);
        render(data || {});
        return;
      }
      // apps.mdx §Notifications (Host → View) ui/notifications/tool-cancelled.
      if (msg.method === 'ui/notifications/tool-cancelled') {
        root.setAttribute('data-state', 'cancelled');
        root.innerHTML = '<p class="kilnry-widget-note">Cancelled' +
          (msg.params && msg.params.reason ? ': ' + escapeHtml(msg.params.reason) : '') + '.</p>';
      }
    });

    // apps.mdx §Standard MCP Messages / §App Capabilities in ui/initialize.
    INIT_ID = request('ui/initialize', {
      appCapabilities: {},
      clientInfo: { name: 'kilnry-widget', version: '1' },
      protocolVersion: ${JSON.stringify(MCP_APPS_PROTOCOL_VERSION)},
    });
  })();
  </script>
</body>
</html>`;
}

// Build an McpServer from the Kilnry tool set. The tools carry their own
// implementations (from @kilnry/core); this registrar binds them to the
// protocol and injects the runtime services. Passing the caller scope lets the
// server refuse a mutating tool for a read-only token before it runs.
export function createKilnryMcpServer(options: {
  version: string;
  tools: KilnryTool[];
  services: ToolServices;
}): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: options.version },
    {
      instructions: MCP_INSTRUCTIONS,
      // tools/list and server/discover are deterministic and identical for every
      // client, so they may be cached by shared caches for five minutes
      // (TRD-10 §1). Absent this hint the SDK emits the conservative default of
      // ttlMs 0 / private.
      cacheHints: {
        'tools/list': { ttlMs: TOOLS_LIST_TTL_MS, cacheScope: 'public' },
        'server/discover': { ttlMs: TOOLS_LIST_TTL_MS, cacheScope: 'public' },
      },
    },
  );

  const scope = options.services.scope;
  for (const tool of [...options.tools].sort((a, b) => a.name.localeCompare(b.name))) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema,
        annotations: tool.annotations,
        ...(tool.meta ? { _meta: tool.meta } : {}),
      },
      async (input: Record<string, unknown>) => {
        // A read-only token cannot run a mutating tool or a mutating action of a
        // mixed tool (TRD-10 §7).
        if (!toolAllowedForScope(tool, scope, input)) {
          const denied = {
            error: {
              code: 'INVALID_INPUT',
              message: 'This token is read-only and cannot run a tool that changes state.',
              retryable: false,
            },
          };
          return {
            content: [{ type: 'text' as const, text: denied.error.message }],
            structuredContent: denied,
          };
        }
        const result = await tool.execute(input, options.services);
        return {
          content: [{ type: 'text' as const, text: result.text }],
          structuredContent: result.structuredContent,
        };
      },
    );
  }

  // F-MCP-03: resource templates — tools return concrete URIs; list returns templates only.
  server.registerResource(
    'kilnry-asset',
    new ResourceTemplate('kilnry://asset/{asset_id}', { list: undefined }),
    { description: 'A Library asset (image, video, audio, 3D).' },
    (_uri, variables) => {
      const id = String(variables.asset_id ?? '');
      return {
        contents: [
          {
            uri: `kilnry://asset/${id}`,
            mimeType: 'application/json',
            text: JSON.stringify({ asset_id: id, preview_url: `/api/media/${id}` }),
          },
        ],
      };
    },
  );
  server.registerResource(
    'kilnry-character',
    new ResourceTemplate('kilnry://character/{handle}', { list: undefined }),
    { description: 'A Character or Element with its references and appearance.' },
    (_uri, variables) => {
      const handle = String(variables.handle ?? '');
      return {
        contents: [
          {
            uri: `kilnry://character/${handle}`,
            mimeType: 'application/json',
            text: JSON.stringify({ handle }),
          },
        ],
      };
    },
  );
  server.registerResource(
    'kilnry-skill',
    new ResourceTemplate('kilnry://skill/{name}', { list: undefined }),
    { description: 'A SKILL.md agent skill.' },
    (_uri, variables) => {
      const name = String(variables.name ?? '');
      return {
        contents: [
          {
            uri: `kilnry://skill/${name}`,
            mimeType: 'text/markdown',
            text: `# ${name}\n\nLoad this skill with kilnry_skills load.`,
          },
        ],
      };
    },
  );
  server.registerResource(
    'kilnry-run',
    new ResourceTemplate('kilnry://run/{run_id}', { list: undefined }),
    { description: 'A reference-sheet or workflow run manifest.' },
    (_uri, variables) => {
      const id = String(variables.run_id ?? '');
      return {
        contents: [
          { uri: `kilnry://run/${id}`, mimeType: 'application/json', text: JSON.stringify({ run_id: id }) },
        ],
      };
    },
  );
  // F-MCP-07: the MCP Apps widget. kilnry_ui returns ui://kilnry/{view}; a client
  // that supports MCP Apps reads it as text/html;profile=mcp-app and renders it
  // in a sandboxed iframe. The HTML is self-contained (no external assets) and
  // read-only; every action it offers is host-gated, so the widget only reads.
  server.registerResource(
    'kilnry-ui',
    new ResourceTemplate('ui://kilnry/{view}', { list: undefined }),
    { description: 'An MCP Apps widget (job progress, asset picker, character picker).' },
    (_uri, variables) => {
      const view = String(variables.view ?? 'job_progress');
      return {
        contents: [
          {
            uri: `ui://kilnry/${view}`,
            mimeType: 'text/html;profile=mcp-app',
            text: uiWidgetHtml(view),
          },
        ],
      };
    },
  );

  // F-MCP-04: prompts — quick starters.
  server.registerPrompt(
    'kilnry.brief',
    {
      description: 'Turn a one-line ask into a structured creative brief and a proposed workflow with cost.',
      argsSchema: { goal: z.string(), format: z.string().optional() },
    },
    ({ goal, format }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Write a structured creative brief for: ${goal}. Format: ${format ?? 'video'}. Then propose the steps and estimate the cost using the kilnry_estimate and kilnry_skills tools.`,
          },
        },
      ],
    }),
  );
  server.registerPrompt(
    'kilnry.ugc_ad',
    {
      description: 'Start the UGC Ad workflow conversation: brief, steps, cost, then plan and run it.',
      argsSchema: { product: z.string(), duration_s: z.string(), style: z.string().optional() },
    },
    ({ product, duration_s, style }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Plan a UGC-style ad for ${product}, ${duration_s} seconds, style ${style ?? 'testimonial'}. Show the brief, the steps and the estimated cost, then run the workflow once I approve the total.`,
          },
        },
      ],
    }),
  );
  server.registerPrompt(
    'kilnry.character_sheet',
    {
      description: 'Run the reference-sheet pipeline with approvals.',
      argsSchema: { handle: z.string() },
    },
    ({ handle }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Build a reference sheet for @${handle} using kilnry_characters_manage build_sheet. Approve the turnaround when it arrives.`,
          },
        },
      ],
    }),
  );
  server.registerPrompt(
    'kilnry.review',
    {
      description: 'Critique an output against its prompt and character.',
      argsSchema: { asset_id: z.string() },
    },
    ({ asset_id }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Review asset ${asset_id}. Read its sidecar with kilnry_library get, compare the output to the prompt, and note any consistency or quality issues.`,
          },
        },
      ],
    }),
  );

  return server;
}

// Serve one MCP request over the stateless streamable HTTP transport and return
// the Web Standard Response. The transport lives in this package so callers (the
// Next.js /mcp route) do not depend on the protocol SDK directly. A fresh
// server and transport per request keeps the endpoint stateless (TRD-10 §1).
export async function handleMcpRequest(
  request: Request,
  options: { version: string; tools: KilnryTool[]; services: ToolServices },
): Promise<Response> {
  // createMcpHandler routes a modern (2026-07-28) client to the streamable HTTP
  // transport and a legacy (2025-06-18 / 2025-11-25) client — Claude Desktop's
  // config-file stdio and older Cursor — to the legacy serving on the same
  // endpoint (F-MCP-08, TRD-10 §1). A fresh server per request keeps it
  // stateless.
  const handler = createMcpHandler(() => createKilnryMcpServer(options));
  return handler.fetch(request);
}
