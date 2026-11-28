'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { simulate, plan } = require('../src/grenade/planner.js');
const frag = { type:'throwable', cookable:true, fuseTime:4, aimDistance:0, rad:1, explodeOnImpact:false, playerCollision:false, forceMaxThrowDistance:false, throwPhysics:{speed:20,velZ:5,playerVelMult:0.6} };
const blast = { rad:{max:12} };
const clear = {complete:true, clear:()=>true, blastClear:()=>true};
const base = {self:{pos:{x:0,y:0},velocity:{x:0,y:0}},allies:[],target:{pos:{x:20,y:0},velocity:{x:0,y:0}},definition:frag,explosion:blast,elapsed:1,latency:0.1,world:clear};
test('simulate accounts for spawn offset, player motion, gravity and drag', () => {
  const input = {origin:{x:0,y:0},direction:{x:1,y:0},strength:1,velocity:{x:0,y:0},definition:frag,flightTime:0.5,world:clear};
  const one = simulate(input);
  assert.ok(one.position.x > 10 && Math.abs(one.position.y + 1) < 1e-8);
  const moving = simulate({...input,velocity:{x:5,y:0}});
  assert.ok(moving.position.x > one.position.x);
  assert.equal(simulate({...input,world:{clear:()=>false}}), null);
  assert.equal(simulate({...input,definition:{...frag,explodeOnImpact:true}}), null);
});
test('target plan rejects dangerous self proximity and can select a viable throw', () => {
  const result = plan(base);
  assert.equal(result.ok,true);
  assert.ok(result.nearestAlly >= 14);
  assert.ok(result.error <= 12);
});
test('guard rejects obstructed or unavailable routes and unknown teammates', () => {
  assert.equal(plan({...base, world:{...clear,clear:()=>false}, mode:'safe'}).reason,'no-verified-path');
  assert.equal(plan({...base, world:{...clear,complete:false}}).reason,'incomplete-data');
  assert.equal(plan({...base, allies:[{pos:{x:20,y:0}}]}).reason,'incomplete-data');
  assert.equal(plan({...base, elapsed:3.7}).reason,'fuse-too-short');
  assert.equal(plan({...base, world:{...clear,blastClear:()=>false}}).reason,'no-verified-path');
});
test('guard searches directions away from allies and fails if no safe landing', () => {
  const result = plan({...base, mode:'safe', target:undefined});
  assert.equal(result.ok,true);
  assert.ok(result.nearestAlly >= 14);
  const selfAndEverywhere = Array.from({length:48},(_,i)=>({pos:{x:20*Math.cos(i*Math.PI/24),y:20*Math.sin(i*Math.PI/24)},velocity:{x:0,y:0}}));
  assert.equal(plan({...base, mode:'safe', allies:selfAndEverywhere}).reason,'no-verified-path');
});
