'use strict';

const { execFile } = require('node:child_process');

// Trouve la carte réseau à joindre pour réveiller le PC : le signal d'allumage (Wake-on-LAN) doit
// viser l'adresse MAC de la carte Ethernet, seule capable de réveiller un PC éteint.
const ADAPTERS_PS = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
@(Get-NetAdapter -Physical -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'Up' } | ForEach-Object {
  $ip = Get-NetIPAddress -InterfaceIndex $_.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue | Select-Object -First 1
  [pscustomobject]@{ mac = [string]$_.MacAddress; media = [string]$_.PhysicalMediaType; ip = if ($ip) { [string]$ip.IPAddress } else { $null } }
}) | ConvertTo-Json -Compress`;

const isPrivateIPv4 = (ip) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip || '');
const normalizeMac = (mac) => String(mac || '').toUpperCase().replace(/[^0-9A-F]/g, '').replace(/(.{2})(?=.)/g, '$1:');
const validMac = (mac) => /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(mac);

// Choisit la carte Ethernet (802.3) branchée au réseau privé ; à défaut, n'importe quelle carte active.
function pickAdapter(adapters) {
  const usable = [].concat(adapters ?? []).filter((a) => validMac(normalizeMac(a.mac)) && isPrivateIPv4(a.ip));
  const wired = usable.find((a) => /802\.3/.test(a.media || ''));
  const chosen = wired || usable[0];
  return chosen ? { mac: normalizeMac(chosen.mac), ip: chosen.ip, wired: Boolean(wired) } : null;
}

function run(script) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout: 20000, maxBuffer: 1 << 20 }, (error, stdout) => (error ? reject(error) : resolve(stdout)));
  });
}

async function wiredAdapter(exec = run) {
  const out = (await exec(ADAPTERS_PS)).trim();
  return pickAdapter(out ? JSON.parse(out) : []);
}

module.exports = { wiredAdapter, pickAdapter, normalizeMac, validMac };
