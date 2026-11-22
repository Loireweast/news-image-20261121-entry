// Render tools/scene.html to entry.png via headless Chrome CDP.
// Usage: WEBGL_POLICY_SHA256=<sha256> node tools/render.mjs <scene.html> <entry.png>
// Node 22 stdlib only: global fetch + WebSocket, child_process spawn.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const [scenePath, outPath] = process.argv.slice(2);
if (!scenePath || !outPath) {
  console.error('usage: node tools/render.mjs <scene.html> <entry.png>');
  process.exit(2);
}
const CHROME = '/opt/meta-chromium/chrome';
const POLICY = '/home/hatch/workspace/makefun/webgl-policy.txt';
const policySha = process.env.WEBGL_POLICY_SHA256;
if (!policySha) {
  console.error('WEBGL_POLICY_SHA256 env var required');
  process.exit(2);
}

const port = 9334;
const profile = '/tmp/chrome-render-prof-21nov';
const chrome = spawn(CHROME, [
  '--headless=new',
  '--no-sandbox',
  '--disable-gpu',
  '--disable-dev-shm-usage',
  `--user-data-dir=${profile}`,
  `--remote-debugging-port=${port}`,
  `--hatch-webgl-allowed-domains-file=${POLICY}`,
  `--hatch-webgl-allowed-domains-sha256=${policySha}`,
  '--allow-file-access-from-files',
  '--hide-scrollbars',
  '--force-device-scale-factor=1',
  '--window-size=1024,1024',
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (p, ms, what) =>
  Promise.race([p, sleep(ms).then(() => { throw new Error(`timeout: ${what}`); })]);

async function waitForDevTools(tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (r.ok) return await r.json();
    } catch { /* not up yet */ }
    await sleep(500);
  }
  throw new Error('DevTools did not come up');
}

let nextId = 1;
const pending = new Map();
let ws;
let resolveLoad;
const loadPromise = new Promise((resolve) => { resolveLoad = resolve; });

function send(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
}

try {
  const version = await withTimeout(waitForDevTools(), 30000, 'devtools up');
  console.log('chrome:', version.Browser);
  ws = new WebSocket(version.webSocketDebuggerUrl);
  await withTimeout(new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error('websocket error'));
  }), 10000, 'websocket open');
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    } else if (msg.method === 'Page.loadEventFired') {
      resolveLoad();
    }
  };

  // Create a blank target first, attach + enable Page, THEN navigate:
  // otherwise the load event can fire before Page.enable and be missed.
  const { targetId } = await withTimeout(
    send('Target.createTarget', { url: 'about:blank' }), 10000, 'createTarget');
  const { sessionId } = await withTimeout(
    send('Target.attachToTarget', { targetId, flatten: true }), 10000, 'attach');
  await withTimeout(send('Page.enable', {}, sessionId), 10000, 'Page.enable');
  await withTimeout(send('Emulation.setDeviceMetricsOverride', {
    width: 1024, height: 1024, deviceScaleFactor: 1, mobile: false,
  }, sessionId), 10000, 'metrics');
  await withTimeout(send('Page.navigate', { url: `file://${scenePath}` }, sessionId),
    10000, 'navigate');
  await withTimeout(loadPromise, 30000, 'page load');
  await sleep(500); // let fonts/layout settle
  const { data } = await withTimeout(
    send('Page.captureScreenshot', { format: 'png' }, sessionId), 30000, 'screenshot');
  const bytes = Buffer.from(data, 'base64');
  writeFileSync(outPath, bytes);
  console.log(`wrote ${bytes.length} bytes to ${outPath}`);
} finally {
  try { ws?.close(); } catch { /* ignore */ }
  chrome.kill('SIGKILL');
}
