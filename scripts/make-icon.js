'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const SIZE = 512;
const ROOT = path.join(__dirname, '..');
const OUTPUTS = [
  { file: path.join(ROOT, 'build', 'icon.png'), size: 512 },
  { file: path.join(ROOT, 'src', 'main', 'assets', 'icon.png'), size: 256 },
  { file: path.join(ROOT, 'src', 'renderer', 'apple-touch-icon.png'), size: 180 },
];

const logo = fs.readFileSync(path.join(ROOT, 'build', 'logo-dark.svg'), 'utf8')
  .replace('width="512" height="512"', 'x="76" y="68" width="360" height="360"')
  .replace('#a89cff', '#ffffff');

const SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="background" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#8b7dff"/>
      <stop offset="1" stop-color="#4b39c9"/>
    </linearGradient>
  </defs>
  <rect x="16" y="16" width="480" height="480" rx="112" fill="url(#background)"/>
  ${logo}
</svg>`;

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: SIZE, height: SIZE, show: false, frame: false, transparent: true,
    webPreferences: { offscreen: true },
  });
  const html = `<html><body style="margin:0;background:transparent">${SVG}</body></html>`;
  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const capture = await window.webContents.capturePage();
  for (const { file, size } of OUTPUTS) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, capture.resize({ width: size, height: size, quality: 'best' }).toPNG());
    console.log(`${path.relative(process.cwd(), file)} ${size}x${size}`);
  }
  app.quit();
});
