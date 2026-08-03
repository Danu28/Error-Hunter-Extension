// e2e/harness.js — extension-agnostic E2E harness on Chrome for Testing via CDP.
// Zero dependencies: uses Node's global WebSocket, fetch, http.
//
// Usage (from a scenario/runner):
//   const { launch, run, assert, assertEq, assertIncludes, sleep } = require('./harness');

const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (r) => {
      let d = '';
      r.on('data', (c) => (d += c));
      r.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

// ── CDP connection ────────────────────────────────────────────────────────────
async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('WS connect failed: ' + wsUrl)); });
  let id = 0;
  const pending = new Map();
  const handlers = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) reject(new Error(m.error.message));
      else resolve(m.result);
    } else if (m.method && handlers.has(m.method)) {
      for (const h of handlers.get(m.method)) h(m.params);
    }
  };
  return {
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const i = ++id;
        pending.set(i, { resolve, reject });
        ws.send(JSON.stringify({ id: i, method, params }));
      });
    },
    on(method, h) { if (!handlers.has(method)) handlers.set(method, []); handlers.get(method).push(h); },
    close() { try { ws.close(); } catch (e) {} }
  };
}

// ── Assertions ────────────────────────────────────────────────────────────────
class AssertionError extends Error {}

function assert(cond, msg) {
  if (!cond) throw new AssertionError('assert failed: ' + (msg || 'condition'));
}
function assertEq(actual, expected, msg) {
  if (actual !== expected) throw new AssertionError(`assertEq failed: ${msg || ''}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
}
function assertIncludes(haystack, needle, msg) {
  if (typeof haystack !== 'string') haystack = JSON.stringify(haystack);
  if (!haystack.includes(needle)) throw new AssertionError(`assertIncludes failed: ${msg || ''}\n  needle: ${needle}\n  haystack: ${haystack.slice(0, 400)}`);
}
function assertMatch(re, str, msg) {
  if (!re.test(str)) throw new AssertionError(`assertMatch failed: ${msg || ''}\n  regex: ${re}\n  string: ${str.slice(0, 400)}`);
}

// ── Session ───────────────────────────────────────────────────────────────────
// opts: { chrome, extension, port, headless, profile? }
async function launch(opts) {
  const profile = opts.profile || path.join(os.tmpdir(), 'eh-e2e-' + opts.port);
  fs.rmSync(profile, { recursive: true, force: true });
  const args = [
    `--remote-debugging-port=${opts.port}`,
    `--user-data-dir=${profile}`,
    `--disable-extensions-except=${opts.extension}`,
    `--load-extension=${opts.extension}`,
    '--no-sandbox', '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    '--window-size=1280,900', '--window-position=100,100'
  ];
  if (opts.headless) args.unshift('--headless=new');
  const chrome = spawn(opts.chrome, args, { stdio: 'ignore' });

  let version = null;
  for (let i = 0; i < 80 && !version; i++) {
    try { version = await getJson(`http://127.0.0.1:${opts.port}/json/version`); } catch (e) {}
    if (!version) await sleep(300);
  }
  if (!version) {
    chrome.kill();
    throw new Error(`Chrome did not start on port ${opts.port} (binary: ${opts.chrome})`);
  }
  const browser = await connect(version.webSocketDebuggerUrl);

  const downloadDir = path.join(profile, 'downloads');
  fs.mkdirSync(downloadDir, { recursive: true });
  await browser.send('Browser.setDownloadBehavior', {
    behavior: 'allow', downloadPath: downloadDir, eventsEnabled: true
  }).catch(() => {});

  // Track anchor/file downloads via Browser.downloadWillBegin + downloadProgress.
  const downloads = new Map(); // guid -> { filename }
  const seenDownloads = new Set(); // guids already returned by nextDownload
  browser.on('Browser.downloadWillBegin', (p) => {
    downloads.set(p.guid, { filename: p.suggestedFilename });
  });
  browser.on('Browser.downloadProgress', (p) => {
    const d = downloads.get(p.guid);
    if (d) d.state = p.state;
  });

  const session = {
    port: opts.port,
    browser,
    chrome,
    profile,
    downloadDir,
    logs: [],
    _targets: new Map(),

    // Wait for the next not-yet-consumed download; resolves to its path (or null on timeout).
    async nextDownload(timeoutMs = 10000) {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        for (const [guid, d] of downloads) {
          if (d.state === 'completed' && !seenDownloads.has(guid)) {
            const p = path.join(downloadDir, d.filename);
            if (fs.existsSync(p)) { seenDownloads.add(guid); return p; }
          }
        }
        await sleep(200);
      }
      return null;
    },

    async readDownloaded(filePath) {
      return fs.readFileSync(filePath, 'utf8');
    },

    async waitForTarget(predicate, timeoutMs = 20000) {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const list = await getJson(`http://127.0.0.1:${this.port}/json/list`);
        const t = list.find(predicate);
        if (t) return t;
        await sleep(300);
      }
      throw new Error('Target not found within ' + timeoutMs + 'ms');
    },

    // Attach CDP to a target by id; enables Runtime + Page, collects logs.
    async attachTarget(targetId, label) {
      const info = await this.waitForTarget((t) => t.id === targetId);
      const conn = await connect(info.webSocketDebuggerUrl);
      conn.targetId = targetId;
      await conn.send('Runtime.enable');
      await conn.send('Page.enable').catch(() => {});
      conn.on('Runtime.consoleAPICalled', (p) => {
        this.logs.push(`[${label || targetId}] console: ` + p.args.map((a) => a.value ?? a.description ?? '').join(' '));
      });
      conn.on('Runtime.exceptionThrown', (p) => {
        this.logs.push(`[${label || targetId}] exception: ` + (p.exceptionDetails?.exception?.description || p.exceptionDetails?.text || ''));
      });
      conn.eval = (js, opts2 = {}) => evalIn(conn, js, opts2);
      conn.click = (selector) => evalIn(conn, `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error('no element: ' + ${JSON.stringify(selector)}); el.click(); return true; })()`);
      conn.ready = () => waitFor(async () => (await evalIn(conn, `document.readyState`)) === 'complete', 15000);
      return conn;
    },

    async newTab(url) {
      const { targetId } = await this.browser.send('Target.createTarget', { url });
      return this.attachTarget(targetId, url);
    },

    // Service worker target of the loaded extension (waitForTarget handles lazy start).
    async sw() {
      const t = await this.waitForTarget((x) => x.type === 'service_worker' && x.url.includes('service-worker.js'));
      return this.attachTarget(t.id, 'SW');
    },

    async extId() {
      const t = await this.waitForTarget((x) => x.type === 'service_worker' && x.url.includes('service-worker.js'));
      return /chrome-extension:\/\/([^/]+)/.exec(t.url)[1];
    },

    async openExtensionPage(name) {
      const id = await this.extId();
      const { targetId } = await this.browser.send('Target.createTarget', { url: `chrome-extension://${id}/${name}` });
      return this.attachTarget(targetId, name);
    },

    async storageGet(key) {
      const sw = await this.sw();
      const v = await sw.eval(`chrome.storage.session.get(${JSON.stringify(key)}).then(v => JSON.stringify(v))`);
      return JSON.parse(v);
    },
    async storageSet(key, val) {
      const sw = await this.sw();
      await sw.eval(`chrome.storage.session.set({ [${JSON.stringify(key)}]: ${JSON.stringify(val)} })`);
    },
    async storageLocalGet(key) {
      const sw = await this.sw();
      const v = await sw.eval(`chrome.storage.local.get(${JSON.stringify(key)}).then(v => JSON.stringify(v))`);
      return JSON.parse(v);
    },

    async close() {
      try { this.browser.close(); } catch (e) {}
      this.chrome.kill();
    }
  };
  return session;
}

async function evalIn(conn, expression, opts = {}) {
  const r = await conn.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    ...opts
  });
  if (r.exceptionDetails) {
    const d = r.exceptionDetails.exception?.description || r.exceptionDetails.text || 'unknown';
    throw new Error('eval failed: ' + d.slice(0, 500));
  }
  return r.result.value;
}

async function waitFor(fn, timeoutMs, intervalMs = 250) {
  const start = Date.now();
  let lastErr = null;
  while (Date.now() - start < timeoutMs) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) { lastErr = e; }
    await sleep(intervalMs);
  }
  throw new Error('waitFor timed out after ' + timeoutMs + 'ms' + (lastErr ? ' (last: ' + lastErr.message + ')' : ''));
}

// ── Test runner ───────────────────────────────────────────────────────────────
async function run(scenarios, ctx = {}, opts = {}) {
  const results = [];
  for (const sc of scenarios) {
    if (opts.only && sc.name !== opts.only) continue;
    const started = Date.now();
    try {
      await sc.run(ctx);
      results.push({ name: sc.name, passed: true, ms: Date.now() - started });
      console.log(`  ✓ ${sc.name} (${Date.now() - started}ms)`);
    } catch (e) {
      results.push({ name: sc.name, passed: false, error: e.message, ms: Date.now() - started });
      console.log(`  ✗ ${sc.name} (${Date.now() - started}ms)`);
      console.log(`    ${String(e.stack || e).split('\n').join('\n    ')}`);
    }
  }
  const passed = results.filter((r) => r.passed);
  console.log('');
  console.log(`E2E: ${passed.length}/${results.length} passed`);
  if (opts.onDone) opts.onDone(results);
  return results.every((r) => r.passed);
}

module.exports = {
  launch, run, evalIn, waitFor, sleep, connect, getJson,
  assert, assertEq, assertIncludes, assertMatch, AssertionError
};
