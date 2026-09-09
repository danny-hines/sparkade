import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compilePlatformerEncounterRoute } from '../packages/archetypes/src/platformer/encounters';
import type {
  PlatformerEncounterModifier,
  PlatformerEncounterRoute,
} from '../packages/shared/src/platformer-encounters';

const gameId = process.argv[2];
if (!gameId)
  throw new Error(
    'Usage: npx tsx scripts/check-platformer-terrain.mts <game-id> [output-directory]',
  );
const output = resolve(process.argv[3] ?? 'data/experiments/platformer-terrain');
mkdirSync(output, { recursive: true });
const session = `platformer-terrain-${process.pid}`;
const run = (args: string[], input?: string) =>
  execFileSync('agent-browser', ['--session', session, ...args], {
    encoding: 'utf8',
    timeout: 45000,
    ...(input ? { input } : {}),
  });
const results = [];
try {
  run(['--args', '--mute-audio', 'open', `http://127.0.0.1:5173/?dev=playtest&game=${gameId}`]);
  run(['wait', '--fn', '!!window.sparkadePlaytest?.instance']);
  for (const modifier of [
    'none',
    'spring',
    'moving-platform',
    'ice',
    'conveyor-forward',
    'conveyor-backward',
  ] as PlatformerEncounterModifier[]) {
    const route: PlatformerEncounterRoute = {
      orientation: 'horizontal',
      direction: 'right',
      sections: ['high-low', 'stepped-route', 'jump-in', 'high-low', 'stepped-route'].map(
        (pattern, i) => ({
          pattern: pattern as 'high-low' | 'stepped-route' | 'jump-in',
          variant: 0,
          challenge: i === 0 ? 'introduce' : i === 4 ? 'test' : 'develop',
          enemy: 'none',
          reward: 'coins',
          modifier: i === 0 ? modifier : 'none',
        }),
      ),
    };
    const level = {
      name: `Terrain: ${modifier}`,
      musicSong: 'theme',
      ...compilePlatformerEncounterRoute(route),
    };
    const code = `(() => {
      const h=window.sparkadePlaytest;h.loop.stop();h.state='game';const g=h.instance;
      g.spec.levels[0]=${JSON.stringify(level)};g.enterLevel(0);h.engineCtx.cards.skip();g.engine.music.stopSong();
      const idle=Object.fromEntries(['UP','DOWN','LEFT','RIGHT','A','B','X','Y','START','SELECT','L','R'].map(k=>[k,{held:false,pressed:false,released:false}]));
      const step=()=>g.update(1/60,idle);const modifier=${JSON.stringify(modifier)};let result={modifier};
      if(modifier==='spring') {
        const e=g.ents.find(e=>e.type==='spring');g.spawnPlayer(Math.floor(e.x/16),15);let top=Infinity;let launched=false;
        for(let i=0;i<90;i++){step();top=Math.min(top,g.py+g.playerH);launched ||= g.pvy < -400;}
        result={...result,pass:launched&&top<9*16,launched,highestFeet:top};
      } else if(modifier==='moving-platform') {
        const e=g.ents.find(e=>e.type==='movingPlatform');step();g.px=e.x+4;g.py=e.y-g.playerH-.001;g.pvx=0;g.pvy=0;g.onGround=true;
        const start=g.px;for(let i=0;i<30;i++)step();result={...result,pass:g.px>start+12&&Math.abs(g.py+g.playerH-e.y)<2,carried:g.px-start};
      } else {
        g.spawnPlayer(26,15);g.onGround=true;g.pvx=modifier==='none'||modifier==='ice'?100:0;
        const start=g.px;for(let i=0;i<6;i++)step();result={...result,pass:modifier==='ice'?g.pvx>90:modifier==='none'?g.pvx<80:modifier==='conveyor-forward'?g.px>start:g.px<start,velocity:g.pvx,travel:g.px-start};
      }
      g.engine.camera.snap(Math.max(0,g.px-g.viewW/2),g.grid.rows*16-g.viewH);h.render(0);g.engine.music.stopSong();return result;
    })()`;
    const result = JSON.parse(run(['eval', '--stdin'], code));
    results.push(result);
    run(['screenshot', resolve(output, `${modifier}.png`)]);
    console.log(JSON.stringify(result));
  }
  const errors = run(['errors']);
  if (errors) throw new Error(errors);
} finally {
  try {
    run(['close']);
  } catch {
    /* The browser may already have exited. */
  }
}
writeFileSync(resolve(output, 'summary.json'), JSON.stringify(results, null, 2) + '\n');
if (results.some((r) => !r.pass)) process.exitCode = 1;
