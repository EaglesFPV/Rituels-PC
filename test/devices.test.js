'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { Devices, Throttle } = require('../src/core/devices');

function setup() {
  const clock = { now: 1_000_000 };
  const config = {};
  let saves = 0;
  const devices = new Devices(config, () => { saves += 1; }, () => clock.now);
  return { clock, config, devices, saves: () => saves };
}

test('un code d\'association est à usage unique et donne un jeton valide', () => {
  const { devices, config } = setup();
  const { code } = devices.createPairing();
  assert.match(code, /^[A-Z2-9]{8}$/);
  const paired = devices.redeem(code.toLowerCase().replace(/^(.{4})/, '$1-'), 'iPhone');
  assert.ok(paired.token);
  assert.equal(devices.verify(paired.token).name, 'iPhone');
  assert.equal(devices.redeem(code, 'autre'), null);
  assert.ok(!JSON.stringify(config).includes(paired.token), 'le jeton ne doit pas être stocké en clair');
});

test('un code expire après 5 minutes', () => {
  const { devices, clock } = setup();
  const { code } = devices.createPairing();
  clock.now += 5 * 60 * 1000 + 1;
  assert.equal(devices.redeem(code, 'tard'), null);
});

test('retirer un appareil révoque son jeton', () => {
  const { devices } = setup();
  const { token, device } = devices.redeem(devices.createPairing().code, 'Pixel');
  assert.ok(devices.verify(token));
  assert.equal(devices.revoke(device.id), true);
  assert.equal(devices.verify(token), null);
  assert.equal(devices.revoke(device.id), false);
});

test('le jeton local n\'est pas enregistré et les faux jetons sont refusés', () => {
  const { devices, config, saves } = setup();
  const before = saves();
  const local = devices.issueLocal();
  assert.deepEqual(devices.verify(local), { local: true });
  assert.equal(saves(), before);
  assert.equal(devices.verify('0'.repeat(64)), null);
  assert.equal(devices.verify(undefined), null);
  assert.deepEqual(config.devices, []);
});

test('le blocage augmente après plusieurs erreurs puis retombe au succès', () => {
  const clock = { now: 0 };
  const throttle = new Throttle(() => clock.now, 3);
  for (let i = 0; i < 2; i++) throttle.fail('ip');
  assert.equal(throttle.remainingMs('ip'), 0);
  throttle.fail('ip');
  assert.equal(throttle.remainingMs('ip'), 30_000);
  clock.now += 30_000;
  throttle.fail('ip');
  assert.equal(throttle.remainingMs('ip'), 60_000);
  throttle.success('ip');
  assert.equal(throttle.remainingMs('ip'), 0);
});
