import sharp from 'sharp';
import {
  GENERATED_FIGHTER_ARENA_BRIGHTNESS,
  GENERATED_FIGHTER_ARENA_HEIGHT,
  GENERATED_FIGHTER_ARENA_PANELS,
  GENERATED_FIGHTER_ARENA_SATURATION,
  GENERATED_FIGHTER_ARENA_WIDTH,
  type FighterSpec,
} from '@sparkade/shared';
import { fighterArtDirectionPrompt } from './fighter-art-direction';

/** v4 bakes the runtime presentation treatment into the normalized PNG. */
export const FIGHTER_ARENA_PROMPT_VERSION = 'fighter-arena-sheet-v4';
export const FIGHTER_ARENA_ASSET_ROLE = 'fighterArenaAtlas' as const;
export const FIGHTER_ARENA_SOURCE_SIZE = 1024;
export const FIGHTER_ARENA_WIDTH = GENERATED_FIGHTER_ARENA_WIDTH;
export const FIGHTER_ARENA_HEIGHT = GENERATED_FIGHTER_ARENA_HEIGHT;
export const FIGHTER_ARENA_ATLAS_HEIGHT = FIGHTER_ARENA_HEIGHT * GENERATED_FIGHTER_ARENA_PANELS;

export function fighterArenaPresentationIsBaked(promptVersion: string): boolean {
  return promptVersion === FIGHTER_ARENA_PROMPT_VERSION;
}

function clean(value: string, limit: number): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, limit);
}

export function buildFighterArenaPrompt(spec: FighterSpec): string {
  const ladder = spec.levels
    .map((level, index) => `rung ${index + 1} ${clean(level.name, 40)}`)
    .join(', ');
  return [
    'FIGHTER ARENA SHEET CONTRACT: create exactly TWO stacked landscape panoramic BACKGROUND PLATE panels in one square image, with the boundary exactly halfway down.',
    `Immutable game-wide art direction: ${fighterArtDirectionPrompt(spec.artDirection)}`,
    `Game premise: ${clean(spec.meta.tagline, 120)}. Exact limited color direction: ${spec.palette.join(', ')}.`,
    `TOP PANEL — one reusable ladder arena that can plausibly host ${ladder}. Make it the iconic recurring tournament venue for this premise, with rich layered scenery and premise-specific environmental props at the far sides and behind the combat plane.`,
    `BOTTOM PANEL — the distinct final arena for ${clean(spec.boss.name, 40)}. Use the same world and rendering language, but make the environment more imposing and climactic. Boss story beat: ${clean(spec.story.bossIntro, 150)}.`,
    'Both panels use the exact same locked side-on fighting-game camera, horizon, scale, pixel density, outline treatment, shading, and lighting logic. They must look like two locations from one game, never two unrelated art styles.',
    `PIXEL-DENSITY CONTRACT: author both source panels as fine-grained pixel art specifically for uniform reduction into a native ${FIGHTER_ARENA_WIDTH}x${FIGHTER_ARENA_HEIGHT} runtime background beside fighters that are 70-90 runtime pixels tall. At final runtime scale, use crisp one-pixel outlines, occasionally two pixels only for the deepest silhouette edge, and mostly 1x1, 1x2, 2x2, or 3-pixel color clusters. Railings, fabric trim, foliage, masonry, lights, and machinery must retain small one-pixel accents. At this 1024px source scale that means approximately two-source-pixel outlines and compact 2-5-source-pixel clusters, never oversized 8-16px blocks. Do not imitate coarse 8-bit tiles, chunky mosaic pixels, or low-resolution art enlarged with nearest-neighbor scaling.`,
    "VISUAL-HIERARCHY CONTRACT: reserve a broad unobstructed central combat zone in each panel. The central 70 percent must be quieter than the edges, with lower contrast, lower saturation, fewer small highlights, no high-frequency texture, and none of the palette's brightest accents directly behind the fighters. Concentrate vivid highlights and intricate props at the far sides or deep in the distance so 70-90px fighters remain the visual focus.",
    'Put columns, lanterns, machinery, foliage, banners without writing, crates, statues, rails, or other thematic props only near the far left/right edges or clearly behind the combat plane. Keep the floor line in the bottom tenth of each panel so the runtime arena floor can overlay it cleanly.',
    'The two panels must remain independent: no object, shadow, character, border, divider, or lighting streak may cross the exact halfway boundary.',
    'Environment only. No fighters, people, crowds, faces, character silhouettes, animals, monsters, weapons, combat effects, text, letters, numbers, logos, UI, health bars, watermark, signature, frame, or panel labels.',
    'Premium fine-grained native 16-bit SNES fighting-game background art with crisp square pixel clusters, readable depth planes, deliberate limited colors, and no photorealism, blur, antialiasing, gradients, or 3D rendering.',
  ].join(' ');
}

/** Convert the model's two stacked source panels into the exact runtime atlas:
 * a 512x300 ladder plate over a 512x300 boss plate. */
export async function normalizeFighterArenaAtlas(image: Buffer): Promise<Buffer> {
  const source = await sharp(image)
    .rotate()
    .resize(FIGHTER_ARENA_SOURCE_SIZE, FIGHTER_ARENA_SOURCE_SIZE, {
      fit: 'fill',
      kernel: sharp.kernel.nearest,
    })
    .removeAlpha()
    .png()
    .toBuffer();
  const panels = await Promise.all(
    [0, 1].map((index) =>
      sharp(source)
        .extract({
          left: 0,
          top: index * (FIGHTER_ARENA_SOURCE_SIZE / 2),
          width: FIGHTER_ARENA_SOURCE_SIZE,
          height: FIGHTER_ARENA_SOURCE_SIZE / 2,
        })
        .resize(FIGHTER_ARENA_WIDTH, FIGHTER_ARENA_HEIGHT, {
          fit: 'cover',
          position: 'centre',
          kernel: sharp.kernel.nearest,
        })
        .modulate({
          brightness: GENERATED_FIGHTER_ARENA_BRIGHTNESS,
          saturation: GENERATED_FIGHTER_ARENA_SATURATION,
        })
        .png({ compressionLevel: 9, adaptiveFiltering: true })
        .toBuffer(),
    ),
  );
  const atlas = await sharp({
    create: {
      width: FIGHTER_ARENA_WIDTH,
      height: FIGHTER_ARENA_ATLAS_HEIGHT,
      channels: 3,
      background: { r: 0, g: 0, b: 0 },
    },
  })
    .composite([
      { input: panels[0]!, left: 0, top: 0 },
      { input: panels[1]!, left: 0, top: FIGHTER_ARENA_HEIGHT },
    ])
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
  await validateFighterArenaAtlas(atlas);
  return atlas;
}

export async function validateFighterArenaAtlas(image: Buffer): Promise<void> {
  const metadata = await sharp(image).metadata();
  if (
    metadata.format !== 'png' ||
    metadata.width !== FIGHTER_ARENA_WIDTH ||
    metadata.height !== FIGHTER_ARENA_ATLAS_HEIGHT
  ) {
    throw new Error(
      `fighter arena atlas must be a ${FIGHTER_ARENA_WIDTH}x${FIGHTER_ARENA_ATLAS_HEIGHT} PNG`,
    );
  }
}
