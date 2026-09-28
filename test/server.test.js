'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { Service, hostAllowed } = require('../src/core/server');

async function start(options = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rituels-'));
  const executed = [];
  const powered = [];
  const service = new Service({
    dataDir, port: 0, voice: false,
    execute: async (op) => { executed.push(op); },
    power: { lock: async () => powered.push('lock'), cancel: async () => powered.push('cancel') },
    ...options,
  });
  await service.start();
  const base = service.localUrl;
  const call = async (route, { method = 'GET', body, token, headers = {} } = {}) => {
    const res = await fetch(base + route, {
      method,
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(method !== 'GET' ? { 'x-pcr': '1' } : {}),
        ...(token ? { cookie: `pcr=${token}` } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => null), headers: res.headers };
  };
  return { service, call, executed, powered, dataDir, stop: () => service.stop() };
}

test('refuse tout sans jeton et expose l\'état de session', async () => {
  const t = await start();
  try {
    assert.equal((await t.call('/api/modes')).status, 401);
    assert.equal((await t.call('/api/status')).status, 401);
    assert.equal((await t.call('/api/session')).body.authed, false);
    const local = t.service.issueLocalToken();
    assert.equal((await t.call('/api/session', { token: local })).body.authed, true);
    assert.equal((await t.call('/api/modes', { token: local })).status, 200);
  } finally { await t.stop(); }
});

test('l\'appairage donne un cookie, une seule fois par code, et bloque après des erreurs', async () => {
  const t = await start();
  try {
    const local = t.service.issueLocalToken();
    const pairing = (await t.call('/api/pair/new', { method: 'POST', token: local })).body;
    assert.match(pairing.qr, /^data:image\/png;base64,/);
    const ok = await t.call('/api/pair', { method: 'POST', body: { code: pairing.code }, headers: { 'user-agent': 'Mozilla/5.0 (iPhone)' } });
    assert.equal(ok.status, 200);
    const cookie = ok.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    const token = /pcr=([0-9a-f]{64})/.exec(cookie)[1];
    assert.equal((await t.call('/api/modes', { token })).status, 200);
    assert.equal((await t.call('/api/devices', { token })).body[0].name, 'iPhone');
    assert.equal((await t.call('/api/pair', { method: 'POST', body: { code: pairing.code } })).status, 401);
    for (let i = 0; i < 5; i++) await t.call('/api/pair', { method: 'POST', body: { code: 'FAUXCODE' } });
    assert.equal((await t.call('/api/pair', { method: 'POST', body: { code: 'FAUXCODE' } })).status, 429);
  } finally { await t.stop(); }
});

test('les écritures exigent l\'en-tête anti-CSRF et l\'hôte doit être local', async () => {
  const t = await start();
  try {
    const local = t.service.issueLocalToken();
    const res = await fetch(t.service.localUrl + '/api/power', {
      method: 'POST', headers: { cookie: `pcr=${local}`, 'content-type': 'application/json' }, body: '{"action":"lock"}',
    });
    assert.equal(res.status, 403);
    assert.deepEqual(t.powered, []);
    assert.equal(hostAllowed('evil.example.com'), false);
    assert.equal(hostAllowed('192.168.1.13:7799'), true);
    assert.equal(hostAllowed('localhost:7799'), true);
    assert.equal(hostAllowed(undefined), false);
  } finally { await t.stop(); }
});

test('exécute un mode dans l\'ordre et continue après une étape en erreur', async () => {
  const executed = [];
  const t = await start({
    execute: async (op) => { executed.push(op.op); if (op.op === 'wallpaper') throw new Error('Image introuvable'); },
  });
  try {
    const local = t.service.issueLocalToken();
    const modes = (await t.call('/api/modes', { method: 'PUT', token: local, body: [{
      id: 'test', name: 'Test', icon: 'x',
      steps: [
        { type: 'volume', level: 20 }, { type: 'wallpaper', path: 'C:\\nope.jpg' },
        { type: 'steam', appId: 'abc' }, { type: 'open', target: 'https://example.com' },
      ],
    }] })).body;
    assert.equal(modes[0].id, 'test');
    const started = (await t.call('/api/modes/test/run', { method: 'POST', token: local })).body;
    assert.equal(started.steps.length, 4);
    assert.equal((await t.call('/api/modes/test/run', { method: 'POST', token: local })).status, 409);
    let run;
    for (let i = 0; i < 40; i++) {
      run = (await t.call('/api/status', { token: local })).body.run;
      if (run.done) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(run.done, true);
    assert.deepEqual(run.steps.map((step) => step.status), ['done', 'error', 'error', 'done']);
    assert.match(run.steps[2].error, /Steam/);
    assert.deepEqual(executed, ['volume', 'wallpaper', 'open']);
    assert.equal((await t.call('/api/modes/inconnu/run', { method: 'POST', token: local })).status, 404);
  } finally { await t.stop(); }
});

test('alimentation et volume : actions validées', async () => {
  const t = await start();
  try {
    const local = t.service.issueLocalToken();
    assert.equal((await t.call('/api/power', { method: 'POST', token: local, body: { action: 'lock' } })).status, 200);
    assert.equal((await t.call('/api/power', { method: 'POST', token: local, body: { action: 'format-c' } })).status, 400);
    assert.equal((await t.call('/api/power', { method: 'POST', token: local, body: { action: 'constructor' } })).status, 400);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.deepEqual(t.powered, ['lock']);
    assert.equal((await t.call('/api/volume', { method: 'POST', token: local, body: { action: 'set', level: 500 } })).status, 200);
    assert.deepEqual(t.executed, [{ op: 'volume', action: 'set', level: 100 }]);
    assert.equal((await t.call('/api/volume', { method: 'POST', token: local, body: { action: 'rm' } })).status, 400);
  } finally { await t.stop(); }
});

test('les réglages sont conservés et seuls les booléens connus sont acceptés', async () => {
  const t = await start();
  try {
    const local = t.service.issueLocalToken();
    const saved = (await t.call('/api/settings', { method: 'PUT', token: local, body: { autostart: true, tray: 'oui', evil: true } })).body;
    assert.deepEqual(saved, { voice: false, autostart: true, tray: true });
    const stored = JSON.parse(fs.readFileSync(path.join(t.dataDir, 'config.json'), 'utf8'));
    assert.equal(stored.settings.autostart, true);
    assert.equal(stored.evil, undefined);
  } finally { await t.stop(); }
});

test('sert les fichiers de l\'interface avec une politique CSP stricte', async () => {
  const t = await start();
  try {
    for (const route of ['/', '/app.js', '/styles.css', '/manifest.webmanifest', '/icon.svg', '/apple-touch-icon.png']) {
      const res = await fetch(t.service.localUrl + route);
      assert.equal(res.status, 200, route);
      assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
    }
    assert.equal((await fetch(t.service.localUrl + '/../server.js')).status, 404);
    assert.equal((await fetch(t.service.localUrl + '/src/core/server.js')).status, 404);
  } finally { await t.stop(); }
});
