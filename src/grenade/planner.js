'use strict';

// Conservative, pure planning prototype based on survev/survev cf49d323.
// It does not send input, cook grenades, or promise a hit/safe outcome.
const PHYSICS = Object.freeze({ maxAimDistance: 18, gravity: 10.5, maxHeight: 5, groundDrag: 2.3, spawnHeight: 0.5, step: 1 / 100 });
const finite = Number.isFinite;
const point = p => p && finite(p.x) && finite(p.y);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const advance = (p, v, t) => ({ x: p.x + v.x * t, y: p.y + v.y * t });

function simulate({ origin, direction, strength, velocity, definition, flightTime, world }) {
  if (!point(origin) || !point(direction) || !point(velocity) || !finite(strength) || strength < 0 || strength > 1 || !finite(flightTime) || flightTime <= 0 || flightTime > 4 || !world || typeof world.clear !== 'function') return null;
  const d = Math.hypot(direction.x, direction.y);
  const ph = definition?.throwPhysics;
  if (Math.abs(d - 1) > 1e-5 || !ph || !finite(ph.speed) || ph.speed <= 0 || !finite(ph.velZ) || !finite(ph.playerVelMult) || !finite(definition.rad) || definition.rad <= 0 || definition.aimDistance !== 0 || definition.explodeOnImpact || definition.playerCollision || definition.forceMaxThrowDistance || definition.fuseVariance || definition.throwPhysics.fixedCollisionHeight || definition.heavyType) return null;
  const spawn = { x: origin.x + direction.x * 0.5 + direction.y, y: origin.y + direction.y * 0.5 - direction.x };
  // Server clips spawning position at obstacles. Reject instead of predicting
  // a bounce or clipping, which could return a misleading 'safe' result.
  const rad = definition.rad * 0.25;
  if (world.clear(origin, spawn, 0, PHYSICS.spawnHeight) !== true) return null;
  let position = spawn, z = PHYSICS.spawnHeight, vz = ph.velZ;
  let vx = direction.x * ph.speed * strength + velocity.x * ph.playerVelMult;
  let vy = direction.y * ph.speed * strength + velocity.y * ph.playerVelMult;
  let elapsed = 0;
  while (elapsed < flightTime - 1e-9) {
    const dt = Math.min(PHYSICS.step, flightTime - elapsed);
    if (z <= 0) {
      const drag = 1 / (1 + dt * PHYSICS.groundDrag);
      vx *= drag; vy *= drag;
    }
    const next = { x: position.x + vx * dt, y: position.y + vy * dt };
    vz -= PHYSICS.gravity * dt;
    const nextZ = Math.max(0, Math.min(PHYSICS.maxHeight, z + vz * dt));
    // A caller must conservatively account for swept radius, height, map
    // bounds and water; false or unknown means no automated plan.
    if (world.clear(position, next, rad, Math.min(z, nextZ)) !== true) return null;
    position = next; z = nextZ; elapsed += dt;
  }
  return { position, height: z, duration: elapsed };
}

function plan(input) {
  const { self, allies, target, definition, explosion, elapsed, latency, world, mode = 'target' } = input || {};
  if (!self || !point(self.pos) || !point(self.velocity) || !Array.isArray(allies) || !allies.every(p => point(p.pos) && point(p.velocity)) || !definition || definition.type !== 'throwable' || !definition.cookable || !finite(definition.fuseTime) || !finite(elapsed) || elapsed < 0 || !finite(latency) || latency < 0 || !explosion || !finite(explosion.rad?.max) || explosion.rad.max <= 0 || !world || world.complete !== true || typeof world.clear !== 'function' || !['target', 'safe'].includes(mode)) return { ok: false, reason: 'incomplete-data' };
  if (mode === 'target' && (!target || !point(target.pos) || !point(target.velocity) || typeof world.blastClear !== 'function')) return { ok: false, reason: 'target-unavailable' };
  // Estimated cook time when the release reaches the server. This assumes
  // elapsed is known in server time; clock/network uncertainty is not solved.
  const flightTime = definition.fuseTime - elapsed - latency;
  if (flightTime <= 0.2 || flightTime > 4) return { ok: false, reason: 'fuse-too-short' };
  const blastTime = latency + flightTime;
  const safetyRadius = explosion.rad.max + 2;
  const origin = advance(self.pos, self.velocity, latency);
  const predictedAllies = [self, ...allies].map(p => advance(p.pos, p.velocity, blastTime));
  const predictedTarget = mode === 'target' ? advance(target.pos, target.velocity, blastTime) : null;
  let best = null;
  for (let angleIndex = 0; angleIndex < 48; angleIndex++) {
    const angle = 2 * Math.PI * angleIndex / 48;
    const direction = { x: Math.cos(angle), y: Math.sin(angle) };
    for (const strength of [0.4, 0.55, 0.7, 0.85, 1]) {
      const trajectory = simulate({ origin, direction, strength, velocity: self.velocity, definition, flightTime, world });
      if (!trajectory) continue;
      const nearest = Math.min(...predictedAllies.map(p => dist(p, trajectory.position)));
      if (nearest < safetyRadius) continue;
      const error = predictedTarget ? dist(predictedTarget, trajectory.position) : 0;
      if (predictedTarget && (error > explosion.rad.max || world.blastClear(trajectory.position, predictedTarget) !== true)) continue;
      const score = mode === 'target' ? -error : nearest;
      if (!best || score > best.score) best = { direction, strength, landing: trajectory.position, flightTime, nearestAlly: nearest, error, score };
    }
  }
  return best ? { ok: true, ...best } : { ok: false, reason: 'no-verified-path' };
}
module.exports = { PHYSICS, simulate, plan };
