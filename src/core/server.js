'use strict';

const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const QRCode = require('qrcode');
const { DEFAULT_MODES, cleanModes, resolveStep } = require('./modes');
const actions = require('./actions');
const { Devices, Throttle } = require('./devices');
const { VoiceListener, findMode } = require('./voice');
const wake = require('./wake');
const { readJson, writeJson } = require('./store');

const RENDERER = path.join(__dirname, '..', 'renderer');
const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json'],
  '/icon.svg': ['icon.svg', 'image/svg+xml'],
  '/apple-touch-icon.png': ['apple-touch-icon.png', 'image/png'],
};
const CSP = "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
const DEFAULT_SETTINGS = { voice: false, autostart: false, tray: true };
const MAX_BODY = 200_000;

const isPrivateIPv4 = (ip) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);

function deviceName(userAgent = '') {
  if (/iPhone/i.test(userAgent)) return 'iPhone';
  if (/iPad/i.test(userAgent)) return 'iPad';
  if (/Android/i.test(userAgent)) return 'Téléphone Android';
  if (/Windows/i.test(userAgent)) return 'PC Windows';
  return 'Appareil';
}

// Protège contre le « DNS rebinding » : seules les adresses locales sont acceptées dans l'en-tête Host.
function hostAllowed(header) {
  if (!header) return false;
  const name = header.replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase();
  return name === 'localhost' || name === '::1' || name === os.hostname().toLowerCase() || name.endsWith('.local') || /^\d{1,3}(\.\d{1,3}){3}$/.test(name);
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

class Service extends EventEmitter {
  #server = null;
  #config;
  #modes;
  #devices;
  #throttle = new Throttle();
  #voice = null;
  #run = null;
  #adapter = null;
  #adapterAt = 0;
  #runCounter = 0;
  #options;

  constructor({ dataDir, port = 7799, version = '0.0.0', execute = actions.execute, power = actions.POWER, voice = true, adapterInfo = wake.wiredAdapter }) {
    super();
    fs.mkdirSync(dataDir, { recursive: true });
    this.#options = { dataDir, version, execute, power, voice, adapterInfo, requestedPort: port };
    this.configFile = path.join(dataDir, 'config.json');
    this.modesFile = path.join(dataDir, 'modes.json');
    this.#config = readJson(this.configFile, {});
    this.#config.port ||= port;
    this.#config.settings = { ...DEFAULT_SETTINGS, ...this.#config.settings };
    this.#devices = new Devices(this.#config, () => this.#saveConfig());
    const stored = readJson(this.modesFile, null);
    this.#modes = Array.isArray(stored) ? stored : DEFAULT_MODES;
    if (!Array.isArray(stored)) writeJson(this.modesFile, this.#modes);
    this.#saveConfig();
  }

  get port() { return this.#server ? this.#server.address().port : this.#config.port; }
  get modes() { return this.#modes; }
  get settings() { return { ...this.#config.settings }; }
  get localUrl() { return `http://127.0.0.1:${this.port}`; }

  lanUrls() {
    const urls = [];
    for (const list of Object.values(os.networkInterfaces())) {
      for (const entry of list || []) if (entry.family === 'IPv4' && !entry.internal) urls.push(entry.address);
    }
    urls.sort((a, b) => Number(isPrivateIPv4(b)) - Number(isPrivateIPv4(a)));
    return urls.map((ip) => `http://${ip}:${this.port}`);
  }

  issueLocalToken() { return this.#devices.issueLocal(); }

  // Carte réseau à viser pour le réveil : mise en cache 30 s, jamais bloquante en cas d'échec.
  async adapter() {
    if (Date.now() - this.#adapterAt > 30_000) {
      this.#adapterAt = Date.now();
      try { this.#adapter = await this.#options.adapterInfo(); } catch { /* on garde la dernière valeur connue */ }
    }
    return this.#adapter;
  }

  start() {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => this.#handle(req, res));
      server.once('error', reject);
      server.listen(this.#config.port, '0.0.0.0', () => {
        server.off('error', reject);
        this.#server = server;
        this.adapter();
        if (this.#options.voice) this.#initVoice();
        resolve(this);
      });
    });
  }

  stop() {
    if (this.#voice) this.#voice.stop();
    return new Promise((resolve) => (this.#server ? this.#server.close(() => resolve()) : resolve()));
  }

  // ---------- modes ----------
  runMode(id) {
    const mode = this.#modes.find((entry) => entry.id === id);
    if (!mode) throw new HttpError(404, 'Mode introuvable');
    if (this.#run && !this.#run.done) throw new HttpError(409, 'Un mode est déjà en cours');
    const resolved = mode.steps.map((step) => {
      try { return { ...resolveStep(step) }; } catch (error) { return { label: error.message, error: error.message }; }
    });
    const run = {
      id: ++this.#runCounter, modeId: mode.id, name: mode.name, icon: mode.icon, done: false,
      steps: resolved.map((step) => ({ label: step.label, status: step.error ? 'error' : 'pending', ...(step.error && { error: step.error }) })),
    };
    this.#run = run;
    (async () => {
      for (let i = 0; i < resolved.length; i++) {
        if (resolved[i].error) continue;
        run.steps[i].status = 'running';
        try {
          await this.#options.execute(resolved[i].op);
          run.steps[i].status = 'done';
        } catch (error) {
          run.steps[i].status = 'error';
          run.steps[i].error = error.message;
        }
        if (resolved[i].op.op !== 'wait') await actions.sleep(300);
      }
      run.done = true;
      this.emit('run-finished', run);
    })();
    this.emit('run-started', run);
    return run;
  }

  #saveModes(list) {
    this.#modes = cleanModes(list);
    writeJson(this.modesFile, this.#modes);
    this.#syncVoice();
    this.emit('modes-changed', this.#modes);
    return this.#modes;
  }

  #saveConfig() { writeJson(this.configFile, this.#config); }

  // ---------- voix ----------
  #initVoice() {
    this.#voice = new VoiceListener();
    this.#voice.on('phrase', (phrase) => {
      const mode = findMode(this.#modes, phrase);
      if (!mode) return;
      try { this.runMode(mode.id); } catch { /* un mode est déjà en cours */ }
    });
    this.#syncVoice();
  }

  #syncVoice() {
    if (!this.#voice) return;
    if (this.#config.settings.voice) this.#voice.start(this.#modes.map((mode) => mode.name));
    else this.#voice.stop();
  }

  #updateSettings(patch) {
    const next = { ...this.#config.settings };
    for (const key of Object.keys(DEFAULT_SETTINGS)) if (typeof patch[key] === 'boolean') next[key] = patch[key];
    const voiceChanged = next.voice !== this.#config.settings.voice;
    this.#config.settings = next;
    this.#saveConfig();
    if (voiceChanged) this.#syncVoice();
    this.emit('settings-changed', this.settings);
    return this.settings;
  }

  // ---------- HTTP ----------
  #status() {
    return {
      host: os.hostname(), version: this.#options.version, urls: this.lanUrls(), run: this.#run, settings: this.settings,
      mac: this.#adapter ? this.#adapter.mac : null,
      voice: this.#voice ? { state: this.#voice.state, message: this.#voice.message || '' } : { state: 'off', message: '' },
    };
  }

  #token(req) {
    const match = /(?:^|;\s*)pcr=([0-9a-f]{64})/.exec(req.headers.cookie || '');
    return match ? match[1] : '';
  }

  #send(res, status, body, headers = {}, type) {
    const object = typeof body === 'object' && !Buffer.isBuffer(body);
    res.writeHead(status, {
      'Content-Type': type || (object ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8'),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': CSP,
      ...headers,
    });
    res.end(object ? JSON.stringify(body) : body);
  }

  async #handle(req, res) {
    try {
      if (!hostAllowed(req.headers.host)) throw new HttpError(421, 'Hôte non autorisé');
      const url = new URL(req.url, 'http://local');
      if (url.pathname.startsWith('/api/')) return await this.#api(req, res, url);
      const entry = req.method === 'GET' && Object.hasOwn(STATIC, url.pathname) && STATIC[url.pathname];
      if (!entry) throw new HttpError(404, 'Introuvable');
      this.#send(res, 200, fs.readFileSync(path.join(RENDERER, entry[0])), {}, entry[1]);
    } catch (error) {
      this.#send(res, error.status || 500, { error: error.status ? error.message : 'Erreur interne' });
    }
  }

  async #body(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY) throw new HttpError(413, 'Requête trop volumineuse');
      chunks.push(chunk);
    }
    try {
      return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
    } catch {
      throw new HttpError(400, 'JSON invalide');
    }
  }

  async #api(req, res, url) {
    const route = url.pathname;
    const send = (status, body, headers) => this.#send(res, status, body, headers);
    const ip = req.socket.remoteAddress;
    const device = this.#devices.verify(this.#token(req));

    if (route === '/api/session' && req.method === 'GET') return send(200, { authed: Boolean(device), host: os.hostname() });
    // En-tête personnalisé exigé sur les écritures : un autre site ne peut pas l'envoyer sans autorisation préalable.
    if (req.method !== 'GET' && req.headers['x-pcr'] !== '1') throw new HttpError(403, 'Requête refusée');

    if (route === '/api/pair' && req.method === 'POST') {
      if (this.#throttle.remainingMs(ip)) throw new HttpError(429, "Trop d'essais, patientez un instant");
      const body = await this.#body(req);
      const paired = this.#devices.redeem(body.code, deviceName(req.headers['user-agent']));
      if (!paired) {
        this.#throttle.fail(ip);
        throw new HttpError(401, 'Code invalide ou expiré');
      }
      this.#throttle.success(ip);
      this.emit('devices-changed');
      return send(200, { ok: true, device: paired.device },
        { 'Set-Cookie': `pcr=${paired.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${365 * 86400}` });
    }

    if (!device) throw new HttpError(401, 'Non connecté');

    if (route === '/api/pair/new' && req.method === 'POST') {
      const { code, expiresAt } = this.#devices.createPairing();
      // Le lien contient l'adresse du PC, son nom et la MAC de la carte Ethernet : l'app Android s'en sert pour l'allumer.
      const adapter = await this.adapter();
      const base = adapter ? `http://${adapter.ip}:${this.port}` : (this.lanUrls()[0] || this.localUrl);
      const details = new URLSearchParams({ pair: code, name: os.hostname(), ...(adapter && { mac: adapter.mac }) });
      const qr = await QRCode.toDataURL(`${base}/#${details}`, { margin: 1, width: 280 });
      return send(200, { code, expiresAt, url: base, qr, mac: adapter ? adapter.mac : null, wired: adapter ? adapter.wired : false });
    }
    if (route === '/api/devices' && req.method === 'GET') return send(200, this.#devices.list());
    let match = route.match(/^\/api\/devices\/(\w+)$/);
    if (match && req.method === 'DELETE') {
      if (!this.#devices.revoke(match[1])) throw new HttpError(404, 'Appareil introuvable');
      this.emit('devices-changed');
      return send(200, { ok: true });
    }
    if (route === '/api/logout' && req.method === 'POST') {
      if (device.id) this.#devices.revoke(device.id);
      return send(200, { ok: true }, { 'Set-Cookie': 'pcr=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
    }
    if (route === '/api/status' && req.method === 'GET') return send(200, this.#status());
    if (route === '/api/settings' && req.method === 'PUT') return send(200, this.#updateSettings(await this.#body(req)));
    if (route === '/api/modes' && req.method === 'GET') return send(200, this.#modes);
    if (route === '/api/modes' && req.method === 'PUT') return send(200, this.#saveModes(await this.#body(req)));
    match = route.match(/^\/api\/modes\/([\w-]+)\/run$/);
    if (match && req.method === 'POST') return send(200, this.runMode(match[1]));
    if (route === '/api/power' && req.method === 'POST') {
      const { action } = await this.#body(req);
      if (!Object.hasOwn(this.#options.power, action)) throw new HttpError(400, 'Action inconnue');
      send(200, { ok: true });
      if (action === 'sleep' || action === 'hibernate') await actions.sleep(1500); // laisse partir la réponse
      Promise.resolve(this.#options.power[action]()).catch(() => {});
      return;
    }
    if (route === '/api/volume' && req.method === 'POST') {
      const { action, level } = await this.#body(req);
      if (!['mute', 'up', 'down', 'set'].includes(action)) throw new HttpError(400, 'Action inconnue');
      await this.#options.execute({ op: 'volume', action, level: Math.max(0, Math.min(100, Math.round(Number(level) || 0))) });
      return send(200, { ok: true });
    }
    throw new HttpError(404, 'Introuvable');
  }
}

module.exports = { Service, hostAllowed };
