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

test('position probe recovers obfuscated visual position before render side effects', () => {
  const start = source.indexOf('function rebornProbeVisualPosition(');
  const end = source.indexOf('function rebornFindGraphics(', start);
  assert.ok(start > 0 && end > start);
  const ctx = vm.createContext({});
  vm.runInContext(`
    ${source.slice(start, end)}
    let effects = 0;
    class Player {
      constructor() { this.qwerty = {x:12,y:34}; }
      render(camera) { const p = camera.abc(this.qwerty); effects++; return p; }
    }
    globalThis.positionKey = rebornProbeVisualPosition(new Player());
    globalThis.effects = effects;
    globalThis.unrelated = rebornProbeVisualPosition({qwerty:4, render(camera) { camera.abc(this.qwerty); }});
    globalThis.ambiguous = rebornProbeVisualPosition({qwerty:{x:1,y:2}, render(camera) { this.other; camera.abc(this.qwerty); }});
  `, ctx);
  assert.equal(ctx.positionKey, 'qwerty');
  assert.equal(ctx.effects, 0);
  assert.equal(ctx.unrelated, null);
  assert.equal(ctx.ambiguous, null);
});

test('aimbot targets enemy but not teammate once positions are mapped', () => {
  const start = source.indexOf('function s(e, n, t, r) {');
  const end = source.indexOf('function u(e, n) {', start);
  const teamStart = source.indexOf('function r(e) {');
  const teamEnd = source.indexOf('function o(e) {', teamStart);
  const ctx = vm.createContext({ performance: {now: () => 1000} });
  vm.runInContext(`
    const Yn = {P:'players',ye:'pool',Y:'self',G:'ui',se:'local',ke:'slot',oe:'controls',ce:'net',Se:'dead',he:'position',N:'camera',we:'toScreen',re:'input'};
    const self = {__id:1,active:true,layer:0,position:{x:0,y:0},local:{slot:0},net:{dead:false}};
    const friend = {__id:2,active:true,layer:0,position:{x:2,y:0},net:{dead:false}};
    const enemy = {__id:3,active:true,layer:0,position:{x:5,y:0},net:{dead:false}};
    const Vn = {game:{initialized:true,ui:{spectating:false},players:{teamInfo:{1:{playerIds:[1,2]},2:{playerIds:[3]}},playerPool:{pool:[self,friend,enemy]}},self,controls:{isBindDown:()=>true},camera:{toScreen:p=>({x:400+p.x,y:300-p.y})},input:{mousePos:{_x:400,_y:300}},pings:[]}};
    const Bn = {lt:{Oe:true,ut:true,yt:true,vt:80,bt:false,kt:false},ct:{Oe:false,ft:false}};
    const jr = {gt:null,dt:null,wt:{},xt:{},_t:null,st:null};
    const Ln = {innerWidth:800,innerHeight:600};
    const Un = {et:null}; const Gn = {ht:[]}; const st=4, dt=13, Rr=Math.PI/90;
    const Sr = n => n===2||n===3, Tr = p => p.layer, Ar = () => true;
    const o = () => null, i = () => null, Ir = () => true, Yt = () => null, Pr = () => 0;
    const tr=()=>{}, er=()=>{}, nr=()=>{}, rebornError=(section,error)=>{throw error};
    let Qt, result = null; const a = event => {result=event};
    class Et {constructor(mode, pos) {this.mode=mode;this.pos=pos;}}
    ${source.slice(teamStart, teamEnd)}
    ${source.slice(start, end)}
    d(); globalThis.result=result; globalThis.target=jr._t;
  `, ctx);
  assert.equal(ctx.result.mode, 'aimbot');
  assert.equal(ctx.target.__id, 3);
  assert.equal(ctx.result.pos.x, 405);
});

test('legacy method hooks restore owned descriptor without clobbering later hooks', () => {
  const start = source.indexOf('function t(e, n, t) {');
  const end = source.indexOf('function r(e) {', start);
  const ctx = vm.createContext({});
  vm.runInContext(`
    const cleanup=[];
    const Ln = {[Symbol.for('duality.injection.core.v1')]: {onDispose(fn) {cleanup.push(fn);}}};
    ${source.slice(start,end)}
    const original = function() { return 1; };
    const obj={method:original};
    t(obj,'method',{apply(e,n,args) {return Reflect.apply(e,n,args) + 1;}});
    globalThis.during = obj.method();
    cleanup.pop()();
    globalThis.restored = obj.method === original;
    t(obj,'method',{apply(e,n,args) {return Reflect.apply(e,n,args);}});
    const newer=()=>3; obj.method=newer; cleanup.pop()();
    globalThis.preservesNewer = obj.method === newer;
  `,ctx);
  assert.equal(ctx.during,2);
  assert.equal(ctx.restored,true);
  assert.equal(ctx.preservesNewer,true);
});
