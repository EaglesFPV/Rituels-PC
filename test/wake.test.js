'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { pickAdapter, normalizeMac, wiredAdapter } = require('../src/core/wake');

test('normalise les adresses MAC au format utilisé par le téléphone', () => {
  assert.equal(normalizeMac('c8-34-8e-7d-ef-7a'), 'C8:34:8E:7D:EF:7A');
  assert.equal(normalizeMac('C8348E7DEF7A'), 'C8:34:8E:7D:EF:7A');
});

test('préfère la carte Ethernet à la carte Wi-Fi', () => {
  const adapters = [
    { mac: 'C8-34-8E-7D-EF-7A', media: 'Native 802.11', ip: '192.168.1.13' },
    { mac: '04-42-1A-11-22-33', media: '802.3', ip: '192.168.1.20' },
  ];
  assert.deepEqual(pickAdapter(adapters), { mac: '04:42:1A:11:22:33', ip: '192.168.1.20', wired: true });
});

test('se rabat sur le Wi-Fi en le signalant, ignore les réseaux non privés et les MAC invalides', () => {
  assert.deepEqual(pickAdapter({ mac: 'C8-34-8E-7D-EF-7A', media: 'Native 802.11', ip: '192.168.1.13' }), { mac: 'C8:34:8E:7D:EF:7A', ip: '192.168.1.13', wired: false });
  assert.equal(pickAdapter([{ mac: '04-42-1A-11-22-33', media: '802.3', ip: '8.8.8.8' }]), null);
  assert.equal(pickAdapter([{ mac: 'pas-une-mac', media: '802.3', ip: '192.168.1.5' }]), null);
  assert.equal(pickAdapter([]), null);
});

test('lit le résultat du diagnostic PowerShell, même vide ou réduit à un seul objet', async () => {
  assert.equal(await wiredAdapter(async () => ''), null);
  const single = JSON.stringify({ mac: '04-42-1A-11-22-33', media: '802.3', ip: '10.0.0.8' });
  assert.deepEqual(await wiredAdapter(async () => single), { mac: '04:42:1A:11:22:33', ip: '10.0.0.8', wired: true });
});
