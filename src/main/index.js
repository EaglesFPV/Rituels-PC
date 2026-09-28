'use strict';

const path = require('node:path');
const { app, BrowserWindow, Tray, Menu, nativeImage, globalShortcut, shell, session, dialog } = require('electron');
const { Service } = require('../core/server');
const { Updater } = require('./updater');

const ICON = path.join(__dirname, 'assets', 'icon.png');
const SHORTCUT = 'Control+Alt+R';
const smoke = process.env.RITUELS_SMOKE === '1'; // démarrage de contrôle utilisé par les tests, sans micro ni mises à jour
const startHidden = process.argv.includes('--hidden');
const dev = process.argv.includes('--dev');

let service = null;
let win = null;
let tray = null;
let quitting = false;
const updater = new Updater();

function showWindow() {
  if (!win) return createWindow(true);
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// Fermer détruit la fenêtre et son processus d'affichage pour libérer la mémoire :
// en jeu, seul le service reste actif.
function closeWindow() {
  if (!win) return;
  if (service.settings.tray) win.close();
  else win.hide();
}

function toggleWindow() {
  if (win && win.isVisible() && win.isFocused()) closeWindow();
  else showWindow();
}

function createWindow(visible) {
  win = new BrowserWindow({
    width: 480, height: 800, minWidth: 380, minHeight: 560,
    show: false, backgroundColor: '#0f1117', autoHideMenuBar: true, icon: ICON, title: 'Rituels PC',
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false, devTools: dev },
  });
  win.removeMenu();
  win.loadURL(service.localUrl);
  win.once('ready-to-show', () => { if (visible) win.show(); });
  win.on('closed', () => { win = null; });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(service.localUrl)) event.preventDefault();
  });
  if (dev) win.webContents.openDevTools({ mode: 'detach' });
}

function refreshTrayMenu() {
  if (!tray) return;
  const modes = service.modes.map((mode) => ({
    label: `${mode.icon} ${mode.name}`,
    click: () => { try { service.runMode(mode.id); } catch { /* un mode est déjà en cours */ } },
  }));
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Ouvrir Rituels PC', click: showWindow },
    { type: 'separator' },
    ...modes,
    ...(modes.length ? [{ type: 'separator' }] : []),
    { label: 'Quitter', click: () => { quitting = true; app.quit(); } },
  ]));
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
  tray.setToolTip(`Rituels PC — ${SHORTCUT.replace('Control', 'Ctrl')} pour ouvrir`);
  tray.on('click', toggleWindow);
  refreshTrayMenu();
}

function applyLoginItem() {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: service.settings.autostart, args: ['--hidden'] });
}

async function boot() {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  service = new Service({
    dataDir: process.env.RITUELS_DATA || app.getPath('userData'),
    port: Number(process.env.RITUELS_PORT) || undefined,
    version: app.getVersion(),
    voice: !smoke,
  });
  try {
    await service.start();
  } catch (error) {
    dialog.showErrorBox('Rituels PC', error.code === 'EADDRINUSE'
      ? `Le port ${service.port} est déjà utilisé par un autre programme. Fermez-le puis relancez Rituels PC.`
      : error.message);
    app.exit(1);
    return;
  }
  // La fenêtre du PC est connectée d'office grâce à un jeton gardé en mémoire ; les téléphones passent par l'association.
  await session.defaultSession.cookies.set({
    url: service.localUrl, name: 'pcr', value: service.issueLocalToken(), httpOnly: true, sameSite: 'strict',
  });
  service.on('modes-changed', refreshTrayMenu);
  service.on('settings-changed', applyLoginItem);
  applyLoginItem();
  if (smoke) createWindow(false);
  else if (!startHidden) createWindow(true); // démarrage masqué : aucune fenêtre, donc aucun processus d'affichage
  createTray();
  globalShortcut.register(SHORTCUT, toggleWindow);
  if (!smoke) updater.start(true);
  if (smoke) runSmokeTest();
}

// Vérifie de bout en bout que l'application démarre et affiche l'interface, puis quitte.
function runSmokeTest() {
  win.webContents.once('did-finish-load', async () => {
    await new Promise((resolve) => setTimeout(resolve, 800));
    const text = await win.webContents.executeJavaScript("document.getElementById('app').innerText");
    console.log('SMOKE ' + JSON.stringify({ url: service.localUrl, text }));
    quitting = true;
    app.quit();
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.on('before-quit', () => { quitting = true; });
  app.on('will-quit', () => { globalShortcut.unregisterAll(); if (service) service.stop(); });
  app.on('window-all-closed', () => { if (quitting || !service.settings.tray) app.quit(); });
  app.whenReady().then(boot);
}
