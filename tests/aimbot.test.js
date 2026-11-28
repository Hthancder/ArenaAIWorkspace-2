'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('src/duality-payload.js', 'utf8');

test('mouse hook retains existing coordinates without waiting for movement', () => {
  const start = source.indexOf('  Zt = () => {');
  const end = source.indexOf('\nlet Qt;', start);
  assert.ok(start > 0 && end > start);
  const hook = source.slice(start, end).replace(/^  Zt = /, 'const Zt = ');
  const ctx = vm.createContext({});
  vm.runInContext(`
    const It = {Le:false, In:false, De:'idle'};
    const mouse = {x:123,y:456};
    const ticker = {add(fn) { this.fn = fn; }};
    const Vn = {game:{input:{mousePos:mouse}},pixi:{ticker}};
    const Yn = {re:'input'};
    const Ln = {innerWidth:800,innerHeight:600,requestAnimationFrame(){}};
    ${hook}
    Zt();
    globalThis.output = [mouse.x,mouse.y,mouse._x,mouse._y,It.Le];
  `, ctx);
  assert.deepEqual(Array.from(ctx.output), [123, 456, 123, 456, true]);
});
