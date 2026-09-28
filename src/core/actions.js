'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const PS_ARGS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command'];

const VOLUME_PS = `
Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public class K { [DllImport("user32.dll")] public static extern void keybd_event(byte b, byte s, uint f, int e); }'
function P($k,$n){ for($i=0;$i -lt $n;$i++){ [K]::keybd_event($k,0,0,0); [K]::keybd_event($k,0,2,0) } }
switch ($env:VOL_ACTION) {
  'mute' { P 173 1 }
  'up'   { P 175 5 }
  'down' { P 174 5 }
  'set'  { P 174 50; P 175 ([int]([int]$env:VOL_LEVEL / 2)) }
}`;

const WALLPAPER_PS = `
Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public class W { [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern int SystemParametersInfo(int a,int b,string c,int d); }'
[void][W]::SystemParametersInfo(20,0,$env:WP_PATH,3)`;

const START_PS = `
$p=@{FilePath=$env:APP_PATH}
if($env:APP_ARGS){$p.ArgumentList=$env:APP_ARGS}
if($env:APP_CWD){$p.WorkingDirectory=$env:APP_CWD}
Start-Process @p`;

function run(file, args, env) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { env: { ...process.env, ...env }, windowsHide: true, timeout: 30000 }, (error, stdout, stderr) => {
      if (error) reject(new Error(String(stderr || error.message).trim().split('\n')[0]));
      else resolve(stdout);
    });
  });
}

const powershell = (script, env) => run('powershell.exe', [...PS_ARGS, script], env);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const HANDLERS = {
  async start({ path: file, args }) {
    const cwd = path.win32.isAbsolute(file) ? path.win32.dirname(file) : '';
    await powershell(START_PS, { APP_PATH: file, APP_ARGS: args || '', APP_CWD: cwd });
  },
  async open({ target }) {
    // explorer.exe ouvre un lien, un protocole (steam://, spotify:) ou un fichier avec le programme par défaut ;
    // il renvoie souvent le code 1 même en cas de succès.
    await run('explorer.exe', [target]).catch(() => {});
  },
  async wallpaper({ path: file }) {
    if (!fs.existsSync(file)) throw new Error('Image introuvable');
    await powershell(WALLPAPER_PS, { WP_PATH: file });
  },
  async volume({ action, level }) {
    await powershell(VOLUME_PS, { VOL_ACTION: action, VOL_LEVEL: String(level ?? 0) });
  },
  async kill({ name }) {
    await run('taskkill.exe', ['/IM', name, '/F']).catch((error) => {
      if (!/not found|introuvable|aucune/i.test(error.message)) throw error;
    });
  },
  wait: ({ seconds }) => sleep(seconds * 1000),
  async ps({ script }) {
    await powershell(script, {});
  },
};

function execute(op) {
  return HANDLERS[op.op](op);
}

const POWER = {
  lock: () => run('rundll32.exe', ['user32.dll,LockWorkStation']),
  sleep: () => run('rundll32.exe', ['powrprof.dll,SetSuspendState', '0,1,0']),
  hibernate: () => run('shutdown.exe', ['/h']),
  shutdown: () => run('shutdown.exe', ['/s', '/t', '15', '/c', 'Extinction demandée par Rituels PC']),
  restart: () => run('shutdown.exe', ['/r', '/t', '15', '/c', 'Redémarrage demandé par Rituels PC']),
  cancel: () => run('shutdown.exe', ['/a']),
};

module.exports = { execute, POWER, sleep };
