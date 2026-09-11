/* global window */
/** Runs real attacks and round transitions against active AI. Restoring player
 * health and staging approach distance isolate progression from human skill;
 * this is a completion regression, not evidence of balanced difficulty. */
export function checkFighterLadder() {
  const host = window.sparkadePlaytest;
  host.loop.stop();
  host.state = 'game';
  const g = host.instance;
  const skipCards = () => {
    for (let i = 0; i < 20 && host.engineCtx.cards.active; i++) host.engineCtx.cards.skip();
  };
  g.start();
  skipCards();
  const bouts = new Map();
  const rounds = new Set();
  let previous = [];
  let frames = 0;
  let hits = 0;
  for (; frames < 90_000 && !g.result; frames++) {
    skipCards();
    const held = [];
    if (g.phase === 'fight' && g.roundPhase === 'fight') {
      bouts.set(g.bout, g.o.profile);
      rounds.add(`${g.bout}:${g.roundNum}`);
      g.p.hp = g.p.maxHp;
      const p = g.p;
      const o = g.o;
      // Approach automatically, but retain live guard, stun, windup, recovery,
      // damage, knockback, AI and all round/bout completion decisions.
      if (p.state !== 'attack' && p.state !== 'hitstun' && p.state !== 'blockstun') {
        p.x = o.x > 256 ? o.x - 32 : o.x + 32;
        p.facing = o.x > p.x ? 1 : -1;
      }
      if (p.confirmed) held.push(p.move === 'punchLow' ? 'Y' : 'X');
      else if (frames % 2 === 0) held.push(frames % 120 < 90 ? 'B' : 'A');
    }
    const input = Object.fromEntries(
      ['UP', 'DOWN', 'LEFT', 'RIGHT', 'A', 'B', 'X', 'Y', 'L', 'R', 'START', 'SELECT'].map(
        (key) => [
          key,
          {
            held: held.includes(key),
            pressed: held.includes(key) && !previous.includes(key),
            released: !held.includes(key) && previous.includes(key),
          },
        ],
      ),
    );
    const before = g.o?.hp;
    g.update(1 / 60, input);
    if (g.o?.hp < before) hits++;
    previous = held;
  }
  skipCards();
  return {
    style: g.spec.fighterStyle,
    outcome: g.result?.outcome ?? 'incomplete',
    bouts: [...bouts.entries()],
    rounds: rounds.size,
    hits,
    score: g.hud.score,
    seconds: frames / 60,
    remainingPulses: g.pulses.length,
  };
}
