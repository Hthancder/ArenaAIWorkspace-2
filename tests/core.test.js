'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const coreSource = fs.readFileSync('duality-injection-core.user.js', 'utf8');

function context() {
  const ctx = vm.createContext({ console, queueMicrotask, setTimeout, clearTimeout });
  vm.runInContext(`globalThis.window = globalThis;
    globalThis.events = {};
    globalThis.addEventListener = (name, cb) => events[name] = cb;
    globalThis.removeEventListener = (name, cb) => { if (events[name] === cb) delete events[name]; };
    globalThis.originalCall = Function.prototype.call;
    globalThis.originalKeys = Object.keys;`, ctx);
  vm.runInContext(coreSource, ctx);
  return ctx;
}
const run = (ctx, code) => vm.runInContext(code, ctx);
const flush = () => new Promise(resolve => setImmediate(resolve));

test('captures early definitions and app, replays to late subscribers and restores hooks', async () => {
  const ctx = context();
  run(ctx, `
    globalThis.defs = {mp5:{type:'gun'},bullet_mp5:{type:'bullet'},frag:{type:'throwable'},explosion_frag:{type:'explosion'}};
    Object.keys(defs);
    globalThis.ticker = { added: [], removed: [], add(fn, context, priority) { this.added.push([fn,context,priority]); }, remove(fn) { this.removed.push(fn); } };
    globalThis.app = {game: {serializeMsg(type, msg) { return [this, type, msg]; }, send(type, msg, other) { return this.serializeMsg(type, msg); }}, pixi: {stage: {}, _ticker: ticker}};
    globalThis.originalSend = app.game.send;
    (function() {}).call(app);
  `);
  await flush();
  run(ctx, `
    globalThis.core = window[Symbol.for('duality.injection.core.v1')];
    core.onReady(value => globalThis.captured = value.app);
    core.onDefinitions(value => globalThis.capturedDefs = value.definitions);
  `);
  assert.equal(ctx.captured, ctx.app);
  assert.equal(ctx.capturedDefs, ctx.defs);
  assert.equal(run(ctx, 'core.status().sender'), 'send');
  assert.equal(run(ctx, `core.hookSender(function(forward, type, msg, ...rest) { msg.changed = true; return forward(type, msg, ...rest); })`), true);
  assert.equal(run(ctx, `globalThis.msg = {}; globalThis.result = app.game.send(3, msg, 9); result[0] === app.game && result[1] === 3 && result[2] === msg && msg.changed`), true);
  assert.equal(run(ctx, `globalThis.cb = () => {}; core.addTicker(cb, 4); ticker.added[0][0] === cb && ticker.added[0][2] === 4`), true);
  run(ctx, 'core.dispose()');
  assert.equal(run(ctx, 'app.game.send === originalSend'), true);
  assert.equal(run(ctx, 'Function.prototype.call === originalCall && Object.keys === originalKeys && ticker.removed[0] === cb'), true);
  assert.equal(run(ctx, 'app.game.send(1, {})[2].changed'), undefined);
});

test('ambiguous senders fail closed', async () => {
  const ctx = context();
  run(ctx, `globalThis.app = { game: {
    serializeMsg() {}, one() { this.serializeMsg(); }, two() { this.serializeMsg(); }
  }, pixi: { stage: {}, ticker: { add() {}, remove() {} } } }; (function(){}).call(app);`);
  await flush();
  assert.equal(run(ctx, `window[Symbol.for('duality.injection.core.v1')].hookSender(() => {})`), false);
  run(ctx, `window[Symbol.for('duality.injection.core.v1')].dispose()`);
});

test('the checked-in build is reproducible and syntactically valid', () => {
  const before = fs.readFileSync('duality-reborn.user.js', 'utf8');
  execFileSync(process.execPath, ['scripts/build.js']);
  assert.equal(fs.readFileSync('duality-reborn.user.js', 'utf8'), before);
  execFileSync(process.execPath, ['--check', 'duality-reborn.user.js']);
  execFileSync(process.execPath, ['--check', 'src/duality-payload.js']);
});
