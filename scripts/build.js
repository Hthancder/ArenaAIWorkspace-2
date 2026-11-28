'use strict';
// Rebuild a single installable userscript from the checked-in upstream bundle,
// the injection core and the adapted (unpacked) iframe payload.
const fs = require('node:fs');
const path = require('node:path');
const removeKxsChat = require('./patch-legacy.js');
const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const upstream = read('duality_client.js');
const bundleStart = upstream.indexOf('/******/ (() => { // webpackBootstrap');
const bundleEnd = upstream.indexOf('\n!function() {', bundleStart);
if (bundleStart < 0 || bundleEnd < 0) throw new Error('Upstream bundle layout changed');
const bundle = removeKxsChat(upstream.slice(bundleStart, bundleEnd));
const core = read('duality-injection-core.user.js').replace(/^\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==\s*/, '');
const payload = read('src/duality-payload.js');
const header = `// ==UserScript==
// @name         Duality Reborn (experimental)
// @namespace    arena.survev.duality-reborn
// @version      0.1.6
// @description  Duality Client connected to Injection Core
// @match        https://survev.io/*
// @match        https://*.survev.io/*
// @run-at       document-start
// @grant        none
// @inject-into  page
// @sandbox      raw
// @noframes
// ==/UserScript==
`;
const bootstrap = `
(() => {
  const start = () => {
    // The original webpack UI needs the DOM. Isolate failures so that the
    // embedded Duality UI can still be loaded if the old launcher breaks.
    try { (function () {\n${bundle}\n})(); }
    catch (error) { console.error('[Duality Reborn] Legacy launcher failed:', error); }
    try {
      const host = document.createElement('div');
      document.body.appendChild(host);
      const shadow = host.attachShadow({ mode: 'closed' });
      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      shadow.appendChild(iframe);
      const child = iframe.contentWindow;
      child.ou = window;
      child.sr = shadow;
      child.sl = url => setTimeout(() => { window.location = url; }, 3000);
      child.setTimeout(${JSON.stringify(payload)}, 0);
    } catch (error) { console.error('[Duality Reborn] Could not start payload:', error); }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
`;
fs.writeFileSync(path.join(root, 'duality-reborn.user.js'), header + core + bootstrap);
