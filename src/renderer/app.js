'use strict';

const $app = document.getElementById('app');
const state = { tab: 'modes', modes: [], status: null, devices: [], online: true, dismissedId: null };
let pollTimer = null;

// ---------- utilitaires ----------
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'class') el.className = value;
    else if (value !== false && value != null) el.setAttribute(key, value === true ? '' : value);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
  return el;
}
const fill = (el, ...kids) => el.replaceChildren(...kids.flat().filter(Boolean));

async function api(path, method = 'GET', body) {
  const res = await fetch('/api' + path, {
    method,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'x-pcr': '1' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/pair') { showPairing(); throw new Error('Non connecté'); }
  if (!res.ok) throw new Error(data.error || 'Erreur ' + res.status);
  return data;
}

function toast(message) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.hidden = true; }, 2600);
}
const guard = (fn) => async (...args) => { try { await fn(...args); } catch (error) { toast(error.message); } };

// ---------- appairage (téléphone) ----------
function showPairing(message) {
  stopPolling();
  const err = h('div', { class: 'err' }, message || '');
  const input = h('input', { placeholder: 'CODE', maxlength: 12, autocapitalize: 'characters', autocomplete: 'off' });
  const go = async () => {
    try { await api('/pair', 'POST', { code: input.value }); init(); } catch (error) { err.textContent = error.message; }
  };
  input.addEventListener('keydown', (event) => event.key === 'Enter' && go());
  fill($app, h('div', { class: 'center' },
    h('div', { style: 'font-size:56px' }, '⚡'),
    h('h1', {}, 'Rituels PC'),
    h('div', { class: 'hint' }, 'Sur le PC : onglet Contrôle → « Associer un téléphone », puis scannez le QR code ou saisissez le code.'),
    input, err, h('button', { class: 'btn primary', onclick: go }, 'Associer')));
}

// ---------- vue principale ----------
function render() {
  const status = state.status;
  const nav = h('nav', {}, [['modes', 'Modes'], ['control', 'Contrôle']].map(([id, label]) =>
    h('button', { class: state.tab === id ? 'on' : '', onclick: guard(async () => { state.tab = id; if (id === 'control') await loadDevices(); render(); }) }, label)));
  fill($app,
    h('header', {}, h('div', { class: 'dot' + (state.online ? '' : ' off') }), h('h1', {}, '⚡ Rituels PC'), h('div', { class: 'host' }, status ? status.host : '')),
    nav,
    state.tab === 'modes' ? modesView() : controlView(),
    runOverlay());
}

function modesView() {
  return h('div', { class: 'grid' },
    state.modes.map((mode) => h('div', { class: 'mode', role: 'button', tabindex: 0, onclick: guard(() => runMode(mode.id)) },
      h('button', { class: 'edit', title: 'Modifier', onclick: (event) => { event.stopPropagation(); openEditor(mode); } }, '✎'),
      h('div', { class: 'ic' }, mode.icon),
      h('div', { class: 'nm' }, mode.name),
      h('div', { class: 'sub' }, `${mode.steps.length} action${mode.steps.length > 1 ? 's' : ''}`))),
    h('button', { class: 'mode new', onclick: () => openEditor(null) }, h('div', { class: 'ic' }, '+'), h('div', {}, 'Nouveau mode')));
}

function controlView() {
  const status = state.status || {};
  const settings = status.settings || {};
  const volume = h('input', { type: 'range', min: 0, max: 100, value: 40 });
  const volumeLabel = h('span', {}, '40 %');
  volume.addEventListener('input', () => { volumeLabel.textContent = volume.value + ' %'; });
  volume.addEventListener('change', guard(() => api('/volume', 'POST', { action: 'set', level: Number(volume.value) })));
  const volumeButton = (label, action) => h('button', { class: 'btn small', onclick: guard(() => api('/volume', 'POST', { action })) }, label);
  const power = (action, icon, label, confirmMessage, cls) => h('button', {
    class: 'btn ' + (cls || ''),
    onclick: guard(async () => {
      if (confirmMessage && !confirm(confirmMessage)) return;
      await api('/power', 'POST', { action });
      toast(action === 'cancel' ? 'Extinction annulée' : label + ' envoyé');
    }),
  }, h('span', {}, icon), label);
  const toggle = (key, label, hint) => h('label', { class: 'check' },
    h('input', { type: 'checkbox', checked: Boolean(settings[key]), onchange: guard(async (event) => {
      await api('/settings', 'PUT', { [key]: event.target.checked });
      await refresh(true);
    }) }), h('div', {}, label, hint ? h('div', { class: 'hint' }, hint) : null));
  const voice = status.voice || { state: 'off' };
  const voiceHint = { listening: 'À l\'écoute : dites « lance » puis le nom d\'un mode.', starting: 'Démarrage du microphone…', error: voice.message }[voice.state]
    || 'Reconnaissance locale de Windows, rien n\'est envoyé sur Internet.';

  return h('div', {},
    h('div', { class: 'panel' }, h('h2', {}, 'Alimentation'),
      h('div', { class: 'power' },
        power('lock', '🔒', 'Verrouiller'), power('sleep', '🌙', 'Veille'), power('hibernate', '❄️', 'Hibernation'),
        power('restart', '🔄', 'Redémarrer', 'Redémarrer le PC dans 15 secondes ?', 'danger'),
        power('shutdown', '⏻', 'Éteindre', 'Éteindre le PC dans 15 secondes ?', 'danger'),
        power('cancel', '✋', 'Annuler'))),
    h('div', { class: 'panel' }, h('h2', {}, 'Volume'),
      h('div', { class: 'row' }, volumeButton('🔇', 'mute'), volumeButton('−', 'down'),
        h('div', { style: 'flex:1;min-width:120px' }, volume), volumeButton('+', 'up'), volumeLabel)),
    h('div', { class: 'panel' }, h('h2', {}, 'Téléphones associés'),
      state.devices.length ? state.devices.map((device) => h('div', { class: 'device' },
        h('div', { class: 'nm' }, device.name, h('div', { class: 'hint' }, 'Associé le ' + new Date(device.createdAt).toLocaleDateString('fr-FR'))),
        h('button', { class: 'btn small danger', onclick: guard(async () => {
          if (!confirm(`Retirer « ${device.name} » ?`)) return;
          await api('/devices/' + device.id, 'DELETE');
          await loadDevices(); render();
        }) }, 'Retirer'))) : h('div', { class: 'hint' }, 'Aucun téléphone associé.'),
      h('div', { class: 'row', style: 'margin-top:10px' }, h('button', { class: 'btn primary', onclick: guard(openPairing) }, 'Associer un téléphone')),
      h('div', { class: 'hint', style: 'margin-top:8px' }, 'Le téléphone doit être sur le même Wi-Fi. Ajoutez ensuite la page à l\'écran d\'accueil pour l\'avoir comme une app.')),
    h('div', { class: 'panel' }, h('h2', {}, 'Réglages'),
      toggle('voice', 'Commandes vocales', voiceHint),
      toggle('autostart', 'Lancer avec Windows', 'Application de bureau uniquement'),
      toggle('tray', 'Rester dans la zone de notification à la fermeture', 'Application de bureau uniquement')));
}

// ---------- exécution d'un mode ----------
async function runMode(id) {
  const run = await api(`/modes/${id}/run`, 'POST');
  state.status = { ...(state.status || {}), run };
  render();
  poll(1000);
}

function runOverlay() {
  const run = state.status && state.status.run;
  if (!run || run.id === state.dismissedId) return null;
  const icons = { pending: '○', running: '◐', done: '✓', error: '✕' };
  return h('div', { class: 'run' },
    h('div', { class: 'big' }, run.done ? '✅' : (run.icon || '⚡')),
    h('h2', {}, run.done ? `${run.name} — prêt` : `${run.name}…`),
    h('ul', {}, run.steps.map((step) => h('li', { class: step.status },
      h('span', { class: `s st-${step.status}` }, icons[step.status]),
      h('div', {}, step.label, step.error ? h('small', {}, step.error) : null)))),
    run.done ? h('button', { class: 'btn primary', onclick: () => { state.dismissedId = run.id; render(); } }, 'Fermer') : null);
}

// ---------- association d'un téléphone ----------
async function openPairing() {
  const pairing = await api('/pair/new', 'POST');
  const known = state.devices.length;
  const dialog = h('dialog', {},
    h('h2', { style: 'margin-top:0' }, 'Associer un téléphone'),
    h('div', { class: 'hint' }, 'Scannez ce QR code avec l\'appareil photo du téléphone (même Wi-Fi que ce PC).'),
    h('img', { class: 'qr', src: pairing.qr, alt: 'QR code d\'association' }),
    h('div', { class: 'hint', style: 'text-align:center' }, `Ou ouvrez ${pairing.url} et saisissez le code :`),
    h('div', { class: 'code' }, pairing.code),
    h('div', { class: 'hint', style: 'text-align:center' }, 'Valable 5 minutes, à usage unique.'),
    pairing.mac ? h('div', { class: 'hint', style: 'text-align:center;margin-top:8px' },
      pairing.wired
        ? `Allumage à distance : adresse MAC ${pairing.mac} (Ethernet).`
        : `Aucune carte Ethernet active : l'allumage à distance ne fonctionnera pas depuis l'extinction (MAC ${pairing.mac}, Wi-Fi).`) : null,
    h('div', { class: 'row', style: 'justify-content:flex-end;margin-top:14px' }, h('button', { class: 'btn', onclick: () => dialog.close() }, 'Fermer')));
  const watcher = setInterval(async () => {
    try {
      await loadDevices();
      if (state.devices.length > known) { toast('Téléphone associé ✓'); dialog.close(); }
    } catch { /* on réessaie */ }
  }, 2000);
  dialog.addEventListener('close', () => { clearInterval(watcher); dialog.remove(); render(); });
  document.body.append(dialog);
  dialog.showModal();
}

// ---------- éditeur de mode ----------
const TYPES = {
  app: { label: 'Lancer une application', fields: [{ k: 'path', l: 'Chemin ou nom du programme', p: 'C:\\Program Files\\...\\app.exe ou chrome' }, { k: 'args', l: 'Arguments (facultatif)', p: '--fullscreen' }] },
  open: { label: 'Ouvrir un lien, un fichier ou un protocole', fields: [{ k: 'target', l: 'Lien ou fichier', p: 'https://…  ou  D:\\musique.mp3' }] },
  steam: { label: 'Jeu Steam', fields: [{ k: 'appId', l: 'Identifiant du jeu (AppID)', p: '730' }], hint: 'L\'AppID se trouve dans l\'adresse de la page Steam du jeu.' },
  epic: { label: 'Jeu Epic Games', fields: [{ k: 'appName', l: 'Nom interne du jeu', p: 'Fortnite' }], hint: 'Nom interne indiqué dans le raccourci Epic du jeu.' },
  battlenet: { label: 'Jeu Battle.net', fields: [{ k: 'game', l: 'Code du jeu', p: 'WoW' }], hint: 'Exemples : WoW, Pro (Overwatch), Fen (Diablo IV).' },
  riot: { label: 'Jeu Riot Games', fields: [{ k: 'product', l: 'Produit', p: 'valorant' }, { k: 'exe', l: 'Chemin de Riot Client (facultatif)', p: 'C:\\Riot Games\\Riot Client\\RiotClientServices.exe' }], hint: 'Exemples : valorant, league_of_legends.' },
  discord: { label: 'Ouvrir Discord', fields: [] },
  spotify: { label: 'Spotify (playlist, album, morceau)', fields: [{ k: 'target', l: 'Lien de partage Spotify', p: 'https://open.spotify.com/playlist/…' }] },
  signalrgb: { label: 'Éclairage SignalRGB', fields: [{ k: 'effect', l: 'Nom de l\'effet', p: 'Rainbow Wave' }] },
  wallpaper: { label: 'Fond d\'écran (image)', fields: [{ k: 'path', l: 'Chemin de l\'image', p: 'C:\\Users\\moi\\Images\\fond.jpg' }] },
  wallpaperengine: { label: 'Fond animé Wallpaper Engine', fields: [{ k: 'path', l: 'Chemin du fond (project.json)', p: '...\\workshop\\content\\431960\\123456\\project.json' }, { k: 'exe', l: 'Chemin de wallpaper64.exe (facultatif)', p: '' }] },
  volume: { label: 'Régler le volume', fields: [{ k: 'level', l: 'Niveau (0–100)', t: 'number' }, { k: 'mute', l: 'Plutôt couper / rétablir le son', t: 'checkbox' }] },
  close: { label: 'Fermer une application', fields: [{ k: 'process', l: 'Nom du processus', p: 'discord.exe' }] },
  wait: { label: 'Attendre', fields: [{ k: 'seconds', l: 'Secondes', t: 'number' }] },
  command: { label: 'Commande PowerShell (avancé)', fields: [{ k: 'command', l: 'Script PowerShell', t: 'textarea' }] },
};
const GROUPS = [
  ['Applications et liens', ['app', 'open']],
  ['Jeux et services', ['steam', 'epic', 'battlenet', 'riot', 'discord', 'spotify', 'signalrgb']],
  ['Bureau', ['wallpaper', 'wallpaperengine', 'volume', 'close']],
  ['Avancé', ['wait', 'command']],
];
const typeOptions = (selected) => GROUPS.map(([label, ids]) => h('optgroup', { label },
  ids.map((id) => h('option', { value: id, selected: id === selected }, TYPES[id].label))));

function openEditor(mode) {
  const draft = mode ? JSON.parse(JSON.stringify(mode)) : { id: '', name: '', icon: '⚡', steps: [] };
  const dialog = h('dialog', {});
  const draw = () => fill(dialog,
    h('h2', { style: 'margin-top:0' }, mode ? 'Modifier le mode' : 'Nouveau mode'),
    h('div', { class: 'row', style: 'align-items:flex-end' },
      h('div', { style: 'width:80px' }, h('label', {}, 'Icône'),
        h('input', { value: draft.icon, maxlength: 4, style: 'text-align:center;font-size:22px', oninput: (event) => { draft.icon = event.target.value; } })),
      h('div', { style: 'flex:1;min-width:160px' }, h('label', {}, 'Nom'),
        h('input', { value: draft.name, placeholder: 'Gaming, Travail, Cinéma…', oninput: (event) => { draft.name = event.target.value; } }))),
    h('label', {}, 'Actions (exécutées dans l\'ordre)'),
    draft.steps.map((step, index) => stepEditor(draft, index, draw)),
    h('div', { class: 'row', style: 'margin-top:8px' },
      h('select', { onchange: (event) => { if (!event.target.value) return; draft.steps.push({ type: event.target.value, level: 40, seconds: 3 }); draw(); } },
        h('option', { value: '' }, '+ Ajouter une action…'), typeOptions(null))),
    h('div', { class: 'row', style: 'margin-top:16px;justify-content:space-between' },
      h('div', {}, mode ? h('button', { class: 'btn danger', onclick: guard(async () => {
        if (!confirm('Supprimer ce mode ?')) return;
        await saveModes(state.modes.filter((entry) => entry.id !== mode.id));
        dialog.close();
      }) }, 'Supprimer') : null),
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => dialog.close() }, 'Annuler'),
        h('button', { class: 'btn primary', onclick: guard(async () => {
          await saveModes(mode ? state.modes.map((entry) => (entry.id === mode.id ? draft : entry)) : [...state.modes, draft]);
          dialog.close();
        }) }, 'Enregistrer'))));
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  draw();
  dialog.showModal();
}

function stepEditor(draft, index, redraw) {
  const step = draft.steps[index];
  const spec = TYPES[step.type];
  const move = (delta) => {
    const target = index + delta;
    if (target < 0 || target >= draft.steps.length) return;
    [draft.steps[index], draft.steps[target]] = [draft.steps[target], draft.steps[index]];
    redraw();
  };
  const field = ({ k, l, p, t }) => {
    if (t === 'checkbox') {
      return h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: Boolean(step[k]), onchange: (event) => { step[k] = event.target.checked; } }), l);
    }
    if (t === 'textarea') {
      return [h('label', {}, l), h('textarea', { rows: 3, oninput: (event) => { step[k] = event.target.value; } }, step[k] || '')];
    }
    return [h('label', {}, l), h('input', {
      type: t || 'text', value: step[k] ?? '', placeholder: p || '',
      oninput: (event) => { step[k] = t === 'number' ? Number(event.target.value) : event.target.value; },
    })];
  };
  return h('div', { class: 'step' },
    h('div', { class: 'top' },
      h('select', { onchange: (event) => { step.type = event.target.value; redraw(); } }, typeOptions(step.type)),
      h('button', { class: 'btn', onclick: () => move(-1) }, '↑'),
      h('button', { class: 'btn', onclick: () => move(1) }, '↓'),
      h('button', { class: 'btn danger', onclick: () => { draft.steps.splice(index, 1); redraw(); } }, '✕')),
    spec.fields.map(field),
    spec.hint ? h('div', { class: 'hint', style: 'margin-top:6px' }, spec.hint) : null);
}

async function saveModes(list) {
  state.modes = await api('/modes', 'PUT', list);
  render();
}

// ---------- rafraîchissement ----------
async function loadDevices() {
  state.devices = await api('/devices');
}

const signature = () => {
  const s = state.status;
  const run = s && s.run;
  return [state.online, state.dismissedId, s && s.voice && s.voice.state, s && JSON.stringify(s.settings),
    run ? run.id + String(run.done) + run.steps.map((step) => step.status).join() : ''].join('|');
};

async function refresh(force) {
  try {
    const before = signature();
    state.status = await api('/status');
    state.online = true;
    if (force || signature() !== before) render();
  } catch {
    if (state.online) { state.online = false; render(); }
  }
}
function poll(ms) { stopPolling(); pollTimer = setInterval(refresh, ms || 2000); }
function stopPolling() { clearInterval(pollTimer); }

async function init() {
  try {
    const hash = new URLSearchParams(location.hash.slice(1));
    if (hash.has('pair')) {
      history.replaceState(null, '', location.pathname);
      try { await api('/pair', 'POST', { code: hash.get('pair') }); } catch (error) { return showPairing(error.message); }
    }
    const session = await api('/session');
    if (!session.authed) return showPairing();
    state.modes = await api('/modes');
    state.status = await api('/status');
    if (state.status.run && state.status.run.done) state.dismissedId = state.status.run.id;
    render();
    poll(1500);
  } catch {
    fill($app, h('div', { class: 'center' }, h('div', {}, 'PC injoignable. Vérifiez que « Rituels PC » est lancé sur le PC.'),
      h('button', { class: 'btn', onclick: init }, 'Réessayer')));
  }
}
init();
