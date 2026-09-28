'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { cleanModes, resolveStep, spotifyUri } = require('../src/core/modes');

test('traduit chaque intégration en opération', () => {
  assert.deepEqual(resolveStep({ type: 'steam', appId: '730' }).op, { op: 'open', target: 'steam://rungameid/730' });
  assert.equal(resolveStep({ type: 'epic', appName: 'Fortnite' }).op.target, 'com.epicgames.launcher://apps/Fortnite?action=launch&silent=true');
  assert.equal(resolveStep({ type: 'battlenet', game: 'WoW' }).op.target, 'battlenet://WoW');
  assert.equal(resolveStep({ type: 'discord' }).op.target, 'discord://');
  assert.equal(resolveStep({ type: 'signalrgb', effect: 'Rainbow Wave' }).op.target, 'signalrgb://effect/apply/Rainbow%20Wave?-silentlaunch-');
  const riot = resolveStep({ type: 'riot', product: 'valorant' }).op;
  assert.equal(riot.op, 'start');
  assert.match(riot.path, /RiotClientServices\.exe$/);
  assert.equal(riot.args, '--launch-product=valorant --launch-patchline=live');
  const engine = resolveStep({ type: 'wallpaperengine', path: 'D:\\wp\\123\\project.json' }).op;
  assert.equal(engine.args, '-control openWallpaper -file "D:\\wp\\123\\project.json"');
});

test('convertit un lien de partage Spotify en URI', () => {
  assert.equal(spotifyUri('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc'), 'spotify:playlist:37i9dQZF1DXcBWIGoYBM5M');
  assert.equal(spotifyUri('https://open.spotify.com/intl-fr/track/4uLU6hMCjMI75M1A2tKUQC'), 'spotify:track:4uLU6hMCjMI75M1A2tKUQC');
  assert.equal(spotifyUri('spotify:album:1DFixLWuPkv3KT3TnV35m3'), 'spotify:album:1DFixLWuPkv3KT3TnV35m3');
  assert.throws(() => spotifyUri('https://evil.example/playlist/123'), /invalide/);
});

test('refuse les valeurs qui pourraient détourner une commande', () => {
  assert.throws(() => resolveStep({ type: 'steam', appId: '730 & calc' }), /Steam/);
  assert.throws(() => resolveStep({ type: 'battlenet', game: 'WoW/../x' }), /Battle\.net/);
  assert.throws(() => resolveStep({ type: 'riot', product: 'valorant --evil' }), /Riot/);
  assert.throws(() => resolveStep({ type: 'signalrgb', effect: 'a&b|c' }), /SignalRGB/);
  assert.throws(() => resolveStep({ type: 'wallpaperengine', path: 'D:\\x" -evil "y' }), /invalide/);
  assert.throws(() => resolveStep({ type: 'close', process: 'a.exe /F & del' }), /processus/);
  assert.throws(() => resolveStep({ type: 'inconnu' }), /inconnu/);
});

test('borne le volume, l\'attente et complète le nom du processus', () => {
  assert.deepEqual(resolveStep({ type: 'volume', level: 250 }).op, { op: 'volume', action: 'set', level: 100 });
  assert.deepEqual(resolveStep({ type: 'volume', mute: true }).op, { op: 'volume', action: 'mute' });
  assert.equal(resolveStep({ type: 'wait', seconds: 9999 }).op.seconds, 300);
  assert.equal(resolveStep({ type: 'close', process: 'discord' }).op.name, 'discord.exe');
});

test('nettoie les modes : types inconnus retirés, identifiants uniques, longueurs bornées', () => {
  const modes = cleanModes([
    { id: 'a', name: ' Jeu ', icon: '', steps: [{ type: 'wait', seconds: 2 }, { type: 'piratage' }, null] },
    { id: 'a', name: 'x'.repeat(200), steps: 'pas une liste' },
    { id: '../../etc', name: 'Chemin' },
  ]);
  assert.equal(modes.length, 3);
  assert.equal(modes[0].name, 'Jeu');
  assert.equal(modes[0].icon, '⚡');
  assert.equal(modes[0].steps.length, 1);
  assert.equal(new Set(modes.map((mode) => mode.id)).size, 3);
  assert.equal(modes[1].name.length, 60);
  assert.deepEqual(modes[1].steps, []);
  assert.match(modes[2].id, /^[\w-]+$/);
  assert.throws(() => cleanModes('non'), /Format/);
});
