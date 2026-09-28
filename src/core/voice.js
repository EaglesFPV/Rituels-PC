'use strict';

const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');

// Reconnaissance vocale 100 % locale : moteur System.Speech intégré à Windows, aucun envoi sur Internet.
// Le moteur ne reconnaît que « <verbe> <nom d'un mode> », ce qui limite les fausses détections.
const SCRIPT = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Speech
$infos = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers()
if (-not $infos -or @($infos).Count -eq 0) { Write-Output 'ERROR|no-recognizer'; exit 2 }
$info = $infos | Where-Object { $_.Culture.TwoLetterISOLanguageName -eq 'fr' } | Select-Object -First 1
if (-not $info) { $info = $infos | Select-Object -First 1 }
$engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine($info)
$modes = New-Object System.Speech.Recognition.Choices
foreach ($n in ($env:RITUELS_MODES -split "\`n")) { if ($n) { $modes.Add($n) } }
$verbs = New-Object System.Speech.Recognition.Choices
if ($info.Culture.TwoLetterISOLanguageName -eq 'fr') { foreach ($v in @('lance','active','démarre','mode')) { $verbs.Add($v) } }
else { foreach ($v in @('start','launch','run','mode')) { $verbs.Add($v) } }
$builder = New-Object System.Speech.Recognition.GrammarBuilder
$builder.Culture = $info.Culture
$builder.Append($verbs)
$builder.Append($modes)
$engine.LoadGrammar((New-Object System.Speech.Recognition.Grammar($builder)))
try { $engine.SetInputToDefaultAudioDevice() } catch { Write-Output 'ERROR|no-microphone'; exit 3 }
Write-Output ('READY|' + $info.Culture.Name)
while ($true) {
  $r = $engine.Recognize()
  if ($r -and $r.Confidence -ge 0.75) { Write-Output ('HEARD|' + $r.Text + '|' + $r.Confidence.ToString([Globalization.CultureInfo]::InvariantCulture)) }
}`;

const ERRORS = {
  'no-recognizer': "Aucune langue de reconnaissance vocale n'est installée dans Windows.",
  'no-microphone': 'Aucun microphone disponible.',
};

const normalize = (value) => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

function parseLine(line) {
  const [kind, a, b] = String(line).trim().split('|');
  if (kind === 'READY') return { type: 'ready', culture: a };
  if (kind === 'ERROR') return { type: 'error', code: a, message: ERRORS[a] || 'Erreur de reconnaissance vocale.' };
  if (kind === 'HEARD' && a) return { type: 'heard', text: a, confidence: Number(b) || 0 };
  return null;
}

// Trouve le mode dont le nom termine la phrase entendue (le nom le plus long l'emporte).
function findMode(modes, heard) {
  const spoken = normalize(heard);
  let best = null;
  for (const mode of modes) {
    const name = normalize(mode.name);
    if (name && (spoken === name || spoken.endsWith(` ${name}`)) && (!best || name.length > normalize(best.name).length)) best = mode;
  }
  return best;
}

class VoiceListener extends EventEmitter {
  #child = null;
  #buffer = '';
  state = 'off';

  start(modeNames) {
    this.stop();
    const names = modeNames.map((name) => String(name).replace(/[^\p{L}\p{N} '-]/gu, ' ').trim()).filter(Boolean);
    if (!names.length) return this.#set('error', 'Créez au moins un mode pour utiliser la voix.');
    this.#set('starting');
    const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64');
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
      env: { ...process.env, RITUELS_MODES: names.join('\n') },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    this.#child = child;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      this.#buffer += chunk;
      let index;
      while ((index = this.#buffer.indexOf('\n')) !== -1) {
        this.#handle(parseLine(this.#buffer.slice(0, index)));
        this.#buffer = this.#buffer.slice(index + 1);
      }
    });
    child.on('error', () => this.#set('error', 'Impossible de démarrer la reconnaissance vocale.'));
    child.on('exit', () => {
      if (this.#child === child) { this.#child = null; if (this.state !== 'error') this.#set('off'); }
    });
  }

  stop() {
    const child = this.#child;
    this.#child = null;
    this.#buffer = '';
    if (child) child.kill();
    if (this.state !== 'off') this.#set('off');
  }

  #handle(event) {
    if (!event) return;
    if (event.type === 'ready') this.#set('listening');
    else if (event.type === 'error') this.#set('error', event.message);
    else if (event.type === 'heard') this.emit('phrase', event.text);
  }

  #set(state, message) {
    this.state = state;
    this.message = message || '';
    this.emit('state', { state, message: this.message });
  }
}

module.exports = { VoiceListener, parseLine, findMode, normalize };
