'use strict';

const fs = require('node:fs');

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

// Écriture atomique : un fichier temporaire puis un renommage, pour ne jamais laisser un JSON tronqué.
function writeJson(file, value) {
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2));
  fs.renameSync(temporary, file);
}

module.exports = { readJson, writeJson };
