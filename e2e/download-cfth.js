// e2e/download-cfth.js — resolve a Chrome for Testing binary.
// Order: --chrome CLI flag → E2E_CHROME env → auto-download (cached in e2e/.cache).

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CACHE_DIR = path.join(__dirname, '.cache');
const LAST_KNOWN = 'https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json';

function platformKey() {
  const p = os.platform();
  if (p === 'win32') return { platform: 'win64', arch: 'x64' };
  if (p === 'darwin') return { platform: os.arch() === 'arm64' ? 'mac-arm64' : 'mac-x64', arch: 'x64' };
  return { platform: 'linux64', arch: 'x64' };
}

function chromePathFor() {
  const root = CACHE_DIR;
  if (os.platform() === 'win32') return path.join(root, 'chrome-win64', 'chrome.exe');
  if (os.platform() === 'darwin') return path.join(root, os.arch() === 'arm64' ? 'chrome-mac-arm64' : 'chrome-mac-x64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing');
  return path.join(root, 'chrome-linux64', 'chrome');
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status} for ${url}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

function extract(zip, dest) {
  fs.mkdirSync(dest, { recursive: true });
  if (os.platform() === 'win32') {
    const r = spawnSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${dest}' -Force`], { stdio: 'pipe' });
    if (r.status !== 0) throw new Error('Expand-Archive failed: ' + r.stderr);
  } else {
    const r = spawnSync('unzip', ['-o', '-q', zip, '-d', dest], { stdio: 'pipe' });
    if (r.status !== 0) throw new Error('unzip failed: ' + r.stderr);
  }
}

async function resolveChromePath(cliFlag) {
  if (cliFlag && fs.existsSync(cliFlag)) return cliFlag;
  if (process.env.E2E_CHROME && fs.existsSync(process.env.E2E_CHROME)) return process.env.E2E_CHROME;
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const exe = chromePathFor();
  if (fs.existsSync(exe)) return exe;
  console.log('No Chrome for Testing found — downloading (~150 MB)...');
  const meta = await (await fetch(LAST_KNOWN)).json();
  const key = platformKey();
  const entry = meta.channels.Stable.downloads.chrome.find((d) => d.platform === key.platform);
  if (!entry) throw new Error('No Chrome for Testing download for ' + JSON.stringify(key));
  const zip = path.join(CACHE_DIR, 'cfth.zip');
  await download(entry.url, zip);
  extract(zip, CACHE_DIR);
  fs.unlinkSync(zip);
  return exe;
}

if (require.main === module) {
  resolveChromePath(process.argv[2])
    .then((p) => console.log('CHROME:', p))
    .catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { resolveChromePath };
