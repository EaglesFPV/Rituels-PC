'use strict';

const crypto = require('node:crypto');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PAIRING_TTL_MS = 5 * 60 * 1000;
const MAX_PAIRINGS = 5;
const MAX_DEVICES = 20;

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const normalizeCode = (code) => String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// Appareils appairés (téléphones) : seul le hachage du jeton est conservé sur le disque.
class Devices {
  #config;
  #save;
  #now;
  #pairings = new Map();
  #local = new Set();

  constructor(config, save, now = Date.now) {
    config.devices ||= [];
    this.#config = config;
    this.#save = save;
    this.#now = now;
  }

  createPairing() {
    const now = this.#now();
    for (const [code, expiresAt] of this.#pairings) if (expiresAt <= now) this.#pairings.delete(code);
    while (this.#pairings.size >= MAX_PAIRINGS) this.#pairings.delete(this.#pairings.keys().next().value);
    let code = '';
    for (let i = 0; i < 8; i++) code += ALPHABET[crypto.randomInt(ALPHABET.length)];
    const expiresAt = now + PAIRING_TTL_MS;
    this.#pairings.set(code, expiresAt);
    return { code, expiresAt };
  }

  redeem(code, name) {
    const key = normalizeCode(code);
    const expiresAt = this.#pairings.get(key);
    if (!expiresAt) return null;
    this.#pairings.delete(key); // usage unique
    if (expiresAt <= this.#now()) return null;
    const token = crypto.randomBytes(32).toString('hex');
    const now = this.#now();
    const device = { id: crypto.randomBytes(6).toString('hex'), hash: sha256(token), name: String(name || 'Appareil').slice(0, 60), createdAt: now, lastSeen: now };
    this.#config.devices = [...this.#config.devices.slice(-(MAX_DEVICES - 1)), device];
    this.#save();
    return { token, device: this.#publicView(device) };
  }

  verify(token) {
    if (typeof token !== 'string' || !token) return null;
    if (this.#local.has(token)) return { local: true };
    const hash = sha256(token);
    const device = this.#config.devices.find((entry) => entry.hash === hash);
    if (!device) return null;
    const now = this.#now();
    if (now - device.lastSeen > 60_000) { device.lastSeen = now; this.#save(); }
    return this.#publicView(device);
  }

  list() {
    return this.#config.devices.map((device) => this.#publicView(device));
  }

  revoke(id) {
    const before = this.#config.devices.length;
    this.#config.devices = this.#config.devices.filter((device) => device.id !== id);
    if (this.#config.devices.length === before) return false;
    this.#save();
    return true;
  }

  // Jeton réservé à la fenêtre du PC : gardé en mémoire uniquement.
  issueLocal() {
    const token = crypto.randomBytes(32).toString('hex');
    this.#local.add(token);
    return token;
  }

  #publicView({ id, name, createdAt, lastSeen }) {
    return { id, name, createdAt, lastSeen };
  }
}

// Blocage progressif des tentatives d'appairage incorrectes (par adresse).
class Throttle {
  #entries = new Map();
  #now;
  #free;

  constructor(now = Date.now, freeAttempts = 5) {
    this.#now = now;
    this.#free = freeAttempts;
  }

  remainingMs(key) {
    const entry = this.#entries.get(key);
    return entry ? Math.max(0, entry.until - this.#now()) : 0;
  }

  fail(key) {
    const entry = this.#entries.get(key) || { count: 0, until: 0 };
    entry.count += 1;
    if (entry.count >= this.#free) entry.until = this.#now() + Math.min(30_000 * 2 ** (entry.count - this.#free), 15 * 60_000);
    this.#entries.set(key, entry);
  }

  success(key) {
    this.#entries.delete(key);
  }
}

module.exports = { Devices, Throttle, normalizeCode };
