'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseLine, findMode, normalize } = require('../src/core/voice');

test('interprète les lignes du moteur vocal', () => {
  assert.deepEqual(parseLine('READY|fr-FR\r'), { type: 'ready', culture: 'fr-FR' });
  assert.deepEqual(parseLine('HEARD|lance Cinéma|0.91'), { type: 'heard', text: 'lance Cinéma', confidence: 0.91 });
  assert.equal(parseLine('ERROR|no-microphone').type, 'error');
  assert.match(parseLine('ERROR|no-microphone').message, /microphone/);
  assert.equal(parseLine('bruit'), null);
});

test('retrouve le mode annoncé, sans tenir compte des accents ni de la casse', () => {
  const modes = [{ id: '1', name: 'Cinéma' }, { id: '2', name: 'Cinéma maison' }, { id: '3', name: 'Travail' }];
  assert.equal(findMode(modes, 'lance cinema').id, '1');
  assert.equal(findMode(modes, 'active CINÉMA MAISON').id, '2');
  assert.equal(findMode(modes, 'mode travail').id, '3');
  assert.equal(findMode(modes, 'lance jeux'), null);
  assert.equal(normalize("L'été  bientôt"), 'l ete bientot');
});
