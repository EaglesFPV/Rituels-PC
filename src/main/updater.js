'use strict';

const { app, Notification } = require('electron');

const FIRST_CHECK_MS = 30_000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

// Mises à jour automatiques depuis les Releases GitHub : téléchargement en arrière-plan,
// installation à la fermeture de l'application.
class Updater {
  #timers = [];

  start(automatic) {
    if (!app.isPackaged || !automatic) return;
    const { autoUpdater } = require('electron-updater');
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowPrerelease = false;
    autoUpdater.logger = null;
    autoUpdater.on('error', () => {});
    autoUpdater.on('update-downloaded', (info) => {
      if (!Notification.isSupported()) return;
      new Notification({
        title: 'Rituels PC — mise à jour prête',
        body: `La version ${info.version} sera installée à la fermeture de l'application.`,
      }).show();
    });
    const check = () => autoUpdater.checkForUpdates().catch(() => {});
    this.#timers = [setTimeout(check, FIRST_CHECK_MS), setInterval(check, CHECK_INTERVAL_MS)];
  }

  stop() {
    for (const timer of this.#timers) { clearTimeout(timer); clearInterval(timer); }
  }
}

module.exports = { Updater };
