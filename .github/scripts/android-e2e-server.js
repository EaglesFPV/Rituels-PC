'use strict';

// Serveur Rituels PC de test pour l'émulateur Android : les actions Windows sont simulées et enregistrées.
const fs = require('node:fs');
const path = require('node:path');
const { Service } = require('../../src/core/server');

const service = new Service({
  dataDir: process.env.E2E_DATA,
  port: 7799,
  voice: false,
  adapterInfo: async () => ({ mac: '04:42:1A:11:22:33', ip: '10.0.2.2', wired: true }),
  execute: async (op) => {
    const file = process.env.E2E_OPS;
    const done = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
    fs.writeFileSync(file, JSON.stringify([...done, op]));
  },
});

service.start().then(async () => {
  if (process.env.E2E_MAKE_CODE !== '1') return console.log('ready (déjà associé)');
  const res = await fetch(`http://127.0.0.1:7799/api/pair/new`, {
    method: 'POST',
    headers: { 'x-pcr': '1', cookie: `pcr=${service.issueLocalToken()}` },
  });
  const { code } = await res.json();
  fs.writeFileSync(process.env.E2E_CODE, code);
  console.log('ready', path.basename(process.env.E2E_CODE));
});
