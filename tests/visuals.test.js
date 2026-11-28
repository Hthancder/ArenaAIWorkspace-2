'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('src/duality-payload.js', 'utf8');
const functionSlice = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));

test('xray processes nested roofs and keeps object passes independent', () => {
  const ctx = vm.createContext({});
  vm.runInContext(`
    const errors = [];
    function rebornError(name) { errors.push(name); }
    const Yn = { j:'roof', F:'objects', Ce:'entries', je:'map', _e:'pool', ye:'items' };
    const Bn = { Re:{ Oe:true, Pe:true, Te:true, Ae:200, Ee:50 } };
    const roof = { texture: { textureCacheIds:['map-building-container-ceiling-05'] }, visible:true };
    const other = { _texture:{textureCacheIds:['wall_01']}, visible:true };
    const tree = { type:'tree_01', sprite:{alpha:1} };
    const Vn = { game: {initialized:true, roof:{layers:[null,null,null,{children:[{children:[roof, other]}]}]},
      get objects() { throw Error('changed object mapping'); }, map:{pool:{items:[tree]}} } };
    ${functionSlice('function n() {', 'function t(')}
    n();
    globalThis.result = {roof:roof.visible, other:other.visible, tree:tree.sprite.alpha, error:errors[0]};
  `, ctx);
  assert.equal(ctx.result.roof, false);
  assert.equal(ctx.result.other, true);
  assert.equal(ctx.result.tree, 0.5);
  assert.equal(ctx.result.error, 'xrayObjects');
});

test('graphics constructor can be found under nested containers', () => {
  const ctx = vm.createContext({});
  vm.runInContext(`${functionSlice('function rebornFindGraphics(', '// A read-only snapshot')}\nclass Graphics { lineStyle() {} clear() {} }\nconst g = new Graphics();\nglobalThis.result = rebornFindGraphics({children:[{children:[g]}]}) === Graphics;`, ctx);
  assert.equal(ctx.result, true);
});

test('xray discovers obfuscated map pools using public building and obstacle shapes', () => {
  const ctx = vm.createContext({});
  vm.runInContext(`
    function rebornError() {}
    const Yn = {};
    const Bn = { Re: { Oe:true, Pe:true, Te:false, Ae:50, Ee:35 } };
    const ceiling = { visible:true }, floor = { visible:true }, tree = { alpha:1 };
    const map = {mapTexture:null, mapLoaded:true,
      _abc:{_xyz:[{active:true, ceiling:{}, imgs:[{isCeiling:true,sprite:ceiling},{isCeiling:false,sprite:floor}]}]},
      _def:{_qrs:[{active:true,type:'tree_01',sprite:tree}]} };
    const Vn = { game: { initialized:true, _obfuscatedMap:map } };
    ${functionSlice('function n() {', 'function t(')}
    n();
    globalThis.result = [ceiling.visible, floor.visible, tree.alpha];
  `, ctx);
  assert.deepEqual(Array.from(ctx.result), [false, true, 0.35]);
});
