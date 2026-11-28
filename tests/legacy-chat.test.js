'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const removeChat = require('../scripts/patch-legacy.js');

test('build removes only KXS chat construction and its toggle', () => {
  const upstream = fs.readFileSync('duality_client.js', 'utf8');
  const start = upstream.indexOf('/******/ (() => { // webpackBootstrap');
  const end = upstream.indexOf('\n!function() {', start);
  const original = upstream.slice(start, end);
  const patched = removeChat(original);
  assert.ok(!patched.includes('this.chat = new KxsChat(this);'));
  assert.ok(!patched.includes('\n                    label: "Chat",'));
  assert.ok(patched.includes('\n                    label: "Voice Chat",'));
  assert.ok(patched.includes('class KxsChat {'));
  assert.doesNotThrow(() => new vm.Script(patched));
  const match = patched.match(/this\.chat = \{ addChatMessage\(\) \{\}, addSystemMessage\(\) \{\}, toggleChat\(\) \{\} \};/);
  assert.ok(match);
  const ctx = vm.createContext({});
  vm.runInContext(`globalThis.client = {}; (function () { ${match[0]} }).call(client); client.chat.addChatMessage('u', 'x'); client.chat.addSystemMessage('x'); client.chat.toggleChat();`, ctx);
});

test('patch fails closed if the upstream constructor or menu layout changes', () => {
  assert.throws(() => removeChat('unrelated code'), /not found uniquely/);
  assert.throws(() => removeChat('this.chat = new KxsChat(this);'), /menu option/);
});
