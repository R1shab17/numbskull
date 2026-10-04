// Headless bot-vs-bot simulation for balancing: node tools/sim.mjs [mode] [map] [bots] [difficulty] [seconds]
import { Game } from '../src/game.js';
const [mode = 'dm', mapId = 'plaza', nb = '8', diff = 'normal', secs = '300'] = process.argv.slice(2);
const g = new Game({ mapId, mode, difficulty: diff, digits: 4, scoreLimit: 999, timeLimit: +secs + 10 });
g.addBots(+nb); g.balanceTeams();
const ev = {};
g.on(e => { ev[e.k] = (ev[e.k] || 0) + 1; if (e.k === 'miss') ev['miss_' + e.reason] = (ev['miss_' + e.reason] || 0) + 1; });
const t0 = Date.now();
let stuck = 0, steps = 0;
const states = {};
for (let t = 0; t < +secs; t += 0.05) {
  g.update(0.05); steps++;
  if (steps % 20 === 0) for (const p of g.players.values()) if (p.brain && p.alive) states[p.brain.state] = (states[p.brain.state] || 0) + 1;
}
const ms = Date.now() - t0;
const ps = [...g.players.values()];
const kills = ps.reduce((a, p) => a + p.kills, 0);
console.log(`${mode}/${mapId} ${nb} bots ${diff}: ${kills} kills in ${secs}s = ${(kills / (+secs / 60)).toFixed(1)}/min, ${(kills / ps.length / (+secs / 60)).toFixed(2)}/player/min  sim ${ms}ms (${(ms / steps).toFixed(2)}ms/step)`);
console.log('events', JSON.stringify(ev));
console.log('team', g.teamScore, 'states', JSON.stringify(states));
console.log(ps.map(p => `${p.name}:${p.kills}/${p.deaths}/${p.misses}${p.caps ? ' c' + p.caps : ''}`).join('  '));
