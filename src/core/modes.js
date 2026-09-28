'use strict';

const path = require('node:path');
const crypto = require('node:crypto');

const DEFAULT_RIOT = 'C:\\Riot Games\\Riot Client\\RiotClientServices.exe';
const DEFAULT_WALLPAPER_ENGINE = 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\wallpaper_engine\\wallpaper64.exe';

const SAFE_NAME = /^[\p{L}\p{N} _.:'()-]{1,100}$/u;
const STRING_FIELDS = {
  path: 500, args: 500, target: 1000, process: 100, command: 4000,
  appId: 20, appName: 100, game: 40, product: 40, effect: 100, exe: 500,
};

const fail = (message) => { throw new Error(message); };
const text = (value) => String(value ?? '').trim();
const required = (value, message) => text(value) || fail(message);
const safeName = (value, message) => (SAFE_NAME.test(text(value)) ? text(value) : fail(message));
const base = (file) => path.win32.basename(file);

function spotifyUri(value) {
  const input = required(value, 'Lien Spotify manquant');
  if (/^spotify:[\w:]+$/.test(input)) return input;
  const match = input.match(/^https:\/\/open\.spotify\.com\/(?:intl-[a-z]{2}\/)?(track|album|playlist|artist|show|episode)\/(\w{10,40})(?:[?#].*)?$/);
  return match ? `spotify:${match[1]}:${match[2]}` : fail('Lien Spotify invalide (collez le lien de partage du morceau ou de la playlist)');
}

// Chaque type d'action se traduit en une opération exécutable par actions.js.
const STEPS = {
  app: (s) => ({
    label: `Lancer ${base(required(s.path, "Chemin de l'application manquant"))}`,
    op: { op: 'start', path: text(s.path), args: text(s.args) },
  }),
  open: (s) => ({ label: `Ouvrir ${required(s.target, 'Cible manquante')}`, op: { op: 'open', target: text(s.target) } }),
  steam: (s) => {
    const id = /^\d{1,10}$/.test(text(s.appId)) ? text(s.appId) : fail('Identifiant Steam invalide (nombre attendu)');
    return { label: `Jeu Steam ${id}`, op: { op: 'open', target: `steam://rungameid/${id}` } };
  },
  epic: (s) => {
    const name = /^[\w.:-]{1,100}$/.test(text(s.appName)) ? text(s.appName) : fail('Identifiant Epic Games invalide');
    return { label: `Jeu Epic ${name}`, op: { op: 'open', target: `com.epicgames.launcher://apps/${encodeURIComponent(name)}?action=launch&silent=true` } };
  },
  battlenet: (s) => {
    const game = /^\w{1,20}$/.test(text(s.game)) ? text(s.game) : fail('Code de jeu Battle.net invalide (ex. WoW, Pro, D3)');
    return { label: `Battle.net ${game}`, op: { op: 'open', target: `battlenet://${game}` } };
  },
  riot: (s) => {
    const product = /^[a-z0-9_]{1,40}$/i.test(text(s.product)) ? text(s.product) : fail('Produit Riot invalide (ex. valorant, league_of_legends)');
    return {
      label: `Riot ${product}`,
      op: { op: 'start', path: text(s.exe) || DEFAULT_RIOT, args: `--launch-product=${product} --launch-patchline=live` },
    };
  },
  discord: () => ({ label: 'Ouvrir Discord', op: { op: 'open', target: 'discord://' } }),
  spotify: (s) => {
    const uri = spotifyUri(s.target);
    return { label: `Spotify ${uri.split(':').slice(1, 3).join(' ')}`, op: { op: 'open', target: uri } };
  },
  signalrgb: (s) => {
    const effect = safeName(s.effect, "Nom d'effet SignalRGB invalide");
    return { label: `Éclairage ${effect}`, op: { op: 'open', target: `signalrgb://effect/apply/${encodeURIComponent(effect)}?-silentlaunch-` } };
  },
  wallpaper: (s) => ({
    label: `Fond d'écran ${base(required(s.path, "Chemin de l'image manquant"))}`,
    op: { op: 'wallpaper', path: text(s.path) },
  }),
  wallpaperengine: (s) => {
    const file = required(s.path, 'Chemin du fond animé (project.json) manquant');
    if (file.includes('"')) fail('Chemin invalide');
    return {
      label: `Wallpaper Engine ${path.win32.basename(path.win32.dirname(file))}`,
      op: { op: 'start', path: text(s.exe) || DEFAULT_WALLPAPER_ENGINE, args: `-control openWallpaper -file "${file}"` },
    };
  },
  volume: (s) => (s.mute
    ? { label: 'Couper / rétablir le son', op: { op: 'volume', action: 'mute' } }
    : { label: `Volume ${clamp(s.level, 0, 100)} %`, op: { op: 'volume', action: 'set', level: clamp(s.level, 0, 100) } }),
  close: (s) => {
    let name = text(s.process);
    if (!/^[\w .-]{1,100}$/.test(name)) fail('Nom de processus invalide');
    if (!/\.exe$/i.test(name)) name += '.exe';
    return { label: `Fermer ${name}`, op: { op: 'kill', name } };
  },
  wait: (s) => ({ label: `Attendre ${clamp(s.seconds, 0, 300)} s`, op: { op: 'wait', seconds: clamp(s.seconds, 0, 300) } }),
  command: (s) => ({ label: 'Commande PowerShell', op: { op: 'ps', script: required(s.command, 'Commande vide') } }),
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Math.round(Number(value) || 0)));
}

function resolveStep(step) {
  const build = Object.hasOwn(STEPS, step && step.type) && STEPS[step.type];
  if (!build) throw new Error("Type d'action inconnu");
  return build(step);
}

function cleanStep(step) {
  const out = { type: step.type };
  for (const [key, max] of Object.entries(STRING_FIELDS)) out[key] = String(step[key] ?? '').slice(0, max);
  out.level = clamp(step.level, 0, 100);
  out.seconds = clamp(step.seconds, 0, 300);
  out.mute = Boolean(step.mute);
  return out;
}

function cleanModes(input) {
  if (!Array.isArray(input) || input.length > 100) throw new Error('Format invalide');
  const seen = new Set();
  return input.map((mode) => {
    let id = String(mode.id ?? '').slice(0, 64).replace(/[^\w-]/g, '');
    if (!id || seen.has(id)) id = crypto.randomBytes(6).toString('hex');
    seen.add(id);
    return {
      id,
      name: String(mode.name ?? '').trim().slice(0, 60) || 'Sans nom',
      icon: String(mode.icon ?? '').trim().slice(0, 8) || '⚡',
      steps: (Array.isArray(mode.steps) ? mode.steps : []).slice(0, 50)
        .filter((step) => step && Object.hasOwn(STEPS, step.type))
        .map(cleanStep),
    };
  });
}

const DEFAULT_MODES = [
  { id: 'detente', name: 'Détente', icon: '🛋️', steps: [{ type: 'volume', level: 30 }, { type: 'open', target: 'https://www.youtube.com' }] },
  { id: 'nuit', name: 'Nuit', icon: '🌙', steps: [{ type: 'volume', level: 10 }] },
];

module.exports = { STEPS, DEFAULT_MODES, cleanModes, resolveStep, spotifyUri };
