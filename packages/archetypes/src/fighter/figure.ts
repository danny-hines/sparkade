// Procedural articulated fighter. Instead of hand-authoring ~11 multi-frame
// sprites per character, we draw a small stick-and-slab figure whose joints are
// posed per state (idle/walk/crouch/jump/punch/kick/block/hit/ko) and colored
// from the game palette. Two distinct fighters = two builds + palette slots.
// All coordinates are figure-local: origin at the feet center, +x is the way
// the fighter FACES, and up is negative — the caller passes facing so the whole
// pose mirrors when the fighters cross over.

export type FighterPose =
  | 'idle'
  | 'walk'
  | 'crouch'
  | 'jump'
  | 'punchHigh'
  | 'punchLow'
  | 'kickHigh'
  | 'kickLow'
  | 'block'
  | 'hit'
  | 'ko';

export interface FighterColors {
  body: string; // gi / torso
  limb: string; // arms + legs
  skin: string; // head
  trim: string; // belt / highlight
  outline: string; // dark outline
}

export interface FigureOpts {
  cx: number; // feet center, screen px
  feetY: number; // feet baseline, screen px
  facing: 1 | -1; // +1 faces right
  pose: FighterPose;
  t: number; // seconds in the current pose (for wind-up animation)
  anim: number; // global time (idle bob / walk cycle)
  scale: number; // build size (~0.95 nimble .. 1.15 heavy)
  colors: FighterColors;
  flash?: boolean; // hit flash (draw solid white)
}

interface Joints {
  hipY: number;
  shY: number; // shoulder
  headY: number;
  lean: number; // torso lean (local x offset at the shoulders)
  fHand: [number, number];
  bHand: [number, number];
  fFoot: [number, number];
  bFoot: [number, number];
}

function lerp(a: number, b: number, k: number): number {
  return a + (b - a) * Math.min(1, Math.max(0, k));
}

/** Joint targets per pose. Distances line up with the move hitboxes in game.ts. */
function poseJoints(o: FigureOpts): Joints {
  const base: Joints = {
    hipY: -17,
    shY: -32,
    headY: -40,
    lean: 0,
    fHand: [4, -22],
    bHand: [-4, -22],
    fFoot: [7, 0],
    bFoot: [-7, 0],
  };
  const bob = Math.sin(o.anim * 3) * 0.8;
  switch (o.pose) {
    case 'idle':
      base.headY += bob;
      base.shY += bob;
      base.fHand = [5, -21 + bob];
      base.bHand = [-4, -21 + bob];
      return base;
    case 'walk': {
      const s = Math.sin(o.anim * 9);
      base.fFoot = [7 + s * 5, 0];
      base.bFoot = [-7 - s * 5, 0];
      base.fHand = [5 - s * 4, -21];
      base.bHand = [-5 + s * 4, -21];
      return base;
    }
    case 'crouch':
      return { hipY: -10, shY: -20, headY: -27, lean: 1, fHand: [6, -14], bHand: [-4, -14], fFoot: [9, 0], bFoot: [-9, 0] };
    case 'jump':
      return { hipY: -19, shY: -33, headY: -41, lean: 1, fHand: [6, -30], bHand: [-5, -28], fFoot: [6, -10], bFoot: [-7, -6] };
    case 'punchHigh': {
      const ext = lerp(6, 22, o.t / 0.06); // fast startup
      base.lean = 2;
      base.fHand = [ext, -31];
      base.bHand = [-6, -22];
      return base;
    }
    case 'punchLow': {
      const ext = lerp(6, 20, o.t / 0.05);
      base.fHand = [ext, -22];
      base.bHand = [-6, -22];
      return base;
    }
    case 'kickHigh': {
      const ext = lerp(7, 24, o.t / 0.1);
      base.lean = -3;
      base.fFoot = [ext, -22];
      base.bFoot = [-8, 0];
      base.fHand = [-2, -22];
      base.bHand = [-8, -20];
      return base;
    }
    case 'kickLow': {
      const ext = lerp(7, 22, o.t / 0.08);
      base.hipY = -13;
      base.shY = -28;
      base.headY = -36;
      base.fFoot = [ext, -3];
      base.bFoot = [-8, 0];
      base.fHand = [2, -20];
      return base;
    }
    case 'block':
      return { hipY: -15, shY: -29, headY: -37, lean: -2, fHand: [7, -30], bHand: [5, -25], fFoot: [6, 0], bFoot: [-8, 0] };
    case 'hit':
      base.lean = -4;
      base.headY = -39;
      base.fHand = [-6, -20];
      base.bHand = [-9, -18];
      base.fFoot = [5, 0];
      base.bFoot = [-9, 0];
      return base;
    case 'ko':
      // collapsed on the back — drawn specially in drawFighter
      return base;
  }
}

function seg(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, w: number, color: string): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

export function drawFighter(ctx: CanvasRenderingContext2D, o: FigureOpts): void {
  const s = o.scale;
  const f = o.facing;
  const X = (lx: number): number => o.cx + f * lx * s;
  const Y = (ly: number): number => o.feetY + ly * s;
  const col = o.flash
    ? { body: '#ffffff', limb: '#ffffff', skin: '#ffffff', trim: '#ffffff', outline: '#ffffff' }
    : o.colors;

  if (o.pose === 'ko') {
    // lying on the back, head toward -facing
    const y = Y(-4);
    seg(ctx, X(-14), y, X(10), y, 8 * s, col.body); // torso on the ground
    seg(ctx, X(10), y, X(20), Y(-2), 5 * s, col.limb); // legs out
    ctx.fillStyle = col.skin;
    ctx.beginPath();
    ctx.arc(X(-16), y, 5 * s, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  const j = poseJoints(o);
  const hip: [number, number] = [0, j.hipY];
  const sh: [number, number] = [j.lean, j.shY];

  // back limbs first (behind the torso)
  seg(ctx, X(hip[0]), Y(hip[1]), X(j.bFoot[0]), Y(j.bFoot[1]), 5 * s, col.limb);
  seg(ctx, X(sh[0]), Y(sh[1]), X(j.bHand[0]), Y(j.bHand[1]), 4 * s, col.limb);

  // torso + belt
  seg(ctx, X(hip[0]), Y(hip[1]), X(sh[0]), Y(sh[1]), 8 * s, col.body);
  ctx.fillStyle = col.trim;
  ctx.fillRect(X(hip[0]) - 4 * s, Y(hip[1]) - 1 * s, 8 * s, 2 * s);

  // head
  ctx.fillStyle = col.skin;
  ctx.beginPath();
  ctx.arc(X(j.lean * 0.6), Y(j.headY), 5 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = col.outline; // a facing eye/brow tick
  ctx.fillRect(X(j.lean * 0.6) + f * 2 * s, Y(j.headY) - 1 * s, 2 * s, 2 * s);

  // front limbs (over the torso)
  seg(ctx, X(hip[0]), Y(hip[1]), X(j.fFoot[0]), Y(j.fFoot[1]), 5 * s, col.limb);
  seg(ctx, X(sh[0]), Y(sh[1]), X(j.fHand[0]), Y(j.fHand[1]), 4 * s, col.limb);
  // fist / foot accent so strikes read
  ctx.fillStyle = col.trim;
  ctx.beginPath();
  ctx.arc(X(j.fHand[0]), Y(j.fHand[1]), 2.4 * s, 0, Math.PI * 2);
  ctx.fill();
}
