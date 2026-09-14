// Dev-only playtest harness (http://localhost:5173/?dev=playtest&arch=hshooter):
// boots a golden game straight into the real GameHost with a keyboard
// InputBroker — no pipeline, no menu. Pass `&game=<id>` to load a saved game,
// or `&auto=1` to skip cards and run the attract AI for a hands-free visual
// check. Audio is on by default (engine defaults); pass `&mute=1` for silent
// automated runs. DEV-gated in app.tsx (stripped from prod).
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { GameHost, InputBroker } from '@sparkade/engine';
import {
  archetypes,
  adventureStyleExample,
  shooterStyleExample,
  platformerStyleExample,
} from '@sparkade/archetypes';
import {
  FIGHTER_COMBAT_PROFILES,
  FIGHTER_STYLE_CATALOG,
  FIGHTER_PROJECTILE_KINDS,
  FIGHTER_PROJECTILE_CATALOG,
  type FighterProjectileKind,
  fighterStyleExample,
  type FighterCombatProfile,
  SHOOTER_PLAY_STYLES,
  ADVENTURE_PLAY_STYLES,
  ADVENTURE_STYLE_CATALOG,
  type AdventurePlayStyle,
  SHOOTER_STYLE_CATALOG,
  type ShooterPlayStyle,
  PLATFORMER_PLAY_STYLES,
  PLATFORMER_STYLE_CATALOG,
  type GameSpec,
  type PlatformerPlayStyle,
} from '@sparkade/shared';
import { api } from '../api';
import { loadLikenessAssets } from '../likeness-assets';
import goldenHshooter from '../../../generation/golden/golden-hshooter.json';

const GOLDENS: Record<string, unknown> = { hshooter: goldenHshooter };

export function PlaytestScreen(): ComponentChildren {
  const fighterComparison =
    new URLSearchParams(location.search).has('fighterStyle') ||
    new URLSearchParams(location.search).has('fighterProjectile');
  const fighterLink = (style: string, projectile?: string): string => {
    const params = new URLSearchParams({ dev: 'playtest', fighterStyle: style });
    const game = new URLSearchParams(location.search).get('game');
    if (game) params.set('game', game);
    if (projectile) params.set('fighterProjectile', projectile);
    return `/?${params}`;
  };
  const adventureComparison = new URLSearchParams(location.search).has('adventureStyle');
  const shooterComparison = new URLSearchParams(location.search).has('shooterStyle');
  const comparison =
    fighterComparison ||
    adventureComparison ||
    shooterComparison ||
    new URLSearchParams(location.search).has('style');
  const ref = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState('');
  const [artNote, setArtNote] = useState('');
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const params = new URLSearchParams(location.search);
    let disposed = false;
    let host: GameHost | null = null;
    const input = new InputBroker();
    input.attach(window);

    void (async () => {
      try {
        const projectileKind = params.get('fighterProjectile');
        if (
          projectileKind &&
          !FIGHTER_PROJECTILE_KINDS.includes(projectileKind as FighterProjectileKind)
        )
          throw new Error('Unknown Fighter projectile');
        const fighterStyle =
          params.get('fighterStyle') ?? (projectileKind ? 'rangedControl' : null);
        if (fighterStyle && !FIGHTER_COMBAT_PROFILES.includes(fighterStyle as FighterCombatProfile))
          throw new Error('Unknown Fighter style');
        const style = params.get('style');
        const shooterStyle = params.get('shooterStyle');
        const adventureStyle = params.get('adventureStyle');
        if (adventureStyle && !ADVENTURE_PLAY_STYLES.includes(adventureStyle as AdventurePlayStyle))
          throw new Error('Unknown Adventure play style');
        if (shooterStyle && !SHOOTER_PLAY_STYLES.includes(shooterStyle as ShooterPlayStyle))
          throw new Error('Unknown shooter play style');
        if (style && !PLATFORMER_PLAY_STYLES.includes(style as PlatformerPlayStyle))
          throw new Error('Unknown platformer play style');
        const gameId =
          params.get('game') ??
          (fighterStyle
            ? 'golden-fighter'
            : adventureStyle
              ? 'golden-adventure'
              : shooterStyle
                ? 'golden-shooter'
                : style
                  ? 'golden-platformer'
                  : null);
        const detail = gameId ? await api.getGame(gameId) : null;
        const arch = params.get('arch') ?? 'hshooter';
        if (gameId && !detail?.spec) throw new Error('This game is not ready to play yet.');
        let spec = (detail?.spec ?? GOLDENS[arch]) as GameSpec | undefined;
        if (!spec) throw new Error(`Unknown playtest game or archetype: ${gameId ?? arch}`);
        if (fighterStyle) {
          if (spec.archetype !== 'fighter') throw new Error('Fighter comparison requires Fighter');
          spec = fighterStyleExample(spec, fighterStyle as FighterCombatProfile);
          if (projectileKind) {
            spec.player.combatProfile = 'rangedControl';
            spec.fighterStyle = 'rangedControl';
            spec.player.projectile = {
              kind: projectileKind as FighterProjectileKind,
              name: FIGHTER_PROJECTILE_CATALOG[projectileKind as FighterProjectileKind].name,
            };
          }
        }
        if (style && spec.archetype === 'platformer')
          spec = platformerStyleExample(spec, style as PlatformerPlayStyle);
        if (shooterStyle) {
          if (spec.archetype !== 'shooter')
            throw new Error('Shooter comparison requires a vertical shooter');
          spec = shooterStyleExample(spec, shooterStyle as ShooterPlayStyle);
        }
        if (adventureStyle) {
          if (spec.archetype !== 'adventure')
            throw new Error('Adventure comparison requires an Adventure game');
          spec = adventureStyleExample(spec, adventureStyle as AdventurePlayStyle);
        }
        const likeness = gameId && detail ? await loadLikenessAssets(gameId, detail.assets) : null;
        const actionRun = params.get('actionRun');
        if (actionRun && spec.archetype === 'platformer' && likeness) {
          const response = await fetch(
            `/api/dev/platformer-actions/${encodeURIComponent(actionRun)}`,
          );
          if (!response.ok) throw new Error('Action experiment could not be loaded');
          const experiment = (await response.json()) as {
            style: string;
            mode: string;
            error: string | null;
            poses: Record<string, string>;
          };
          if (experiment.style === spec.playStyle) {
            if (experiment.error) throw new Error(experiment.error);
            const actions = await Promise.all(
              Object.entries(experiment.poses).map(async ([pose, src]) => {
                const image = new Image();
                image.src = src;
                await image.decode();
                return [pose, image] as const;
              }),
            );
            likeness.platformerPoses = {
              ...likeness.platformerPoses,
              ...Object.fromEntries(actions),
            };
            spec.actionPoseVersion = 1;
            setArtNote(
              `${experiment.mode === 'live' ? 'Live generated' : 'Mock'} action poses · ${actionRun}`,
            );
          }
        } else if (comparison)
          setArtNote(
            fighterComparison
              ? 'Shared roster artwork. Confirm hits to chain; counter and pulse kits reuse combat poses.'
              : adventureComparison
                ? 'Authored Adventure comparisons with shared artwork. Arrows move, Z attacks, S uses the tool, X interacts, A resets puzzles, Right Shift opens the map.'
                : shooterComparison
                  ? 'Authored shooter comparisons with shared craft artwork. X selects the signature weapon; Y fires, B bombs, A changes speed.'
                  : 'Controller comparison with shared base artwork. New games generate mechanic-specific action poses.',
          );
        if (disposed) return;
        host = new GameHost({
          canvas,
          spec,
          archetype: archetypes[spec.archetype],
          input,
          likeness,
          attract: params.get('auto') === '1',
          volumes:
            params.get('mute') === '1'
              ? { musicVol: 0, sfxVol: 0, uiVol: 0 }
              : { musicVol: 0.7, sfxVol: 0.8, uiVol: 0.4 },
          callbacks: {
            onQuit: () => {},
            onVolumesChanged: () => {},
            initialScores: [],
            submitScore: async () => [],
          },
        });
        host.start();
        // Dev-only inspection point for deterministic input replay and canvas diagnostics.
        (window as Window & { sparkadePlaytest?: GameHost }).sparkadePlaytest = host;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Playtest failed to load.');
      }
    })();

    return () => {
      disposed = true;
      host?.dispose();
      delete (window as Window & { sparkadePlaytest?: GameHost }).sparkadePlaytest;
      input.detach(window);
    };
  }, []);
  return (
    <div style="display:flex;flex-direction:column;align-items:center;min-height:600px;background:#000">
      {fighterComparison && (
        <nav
          style="display:flex;gap:20px;padding:12px;font:14px monospace"
          aria-label="Fighter play styles"
        >
          {FIGHTER_COMBAT_PROFILES.map((style) => (
            <a key={style} style="color:#aee9f1" href={fighterLink(style)}>
              {FIGHTER_STYLE_CATALOG[style].name}
            </a>
          ))}
        </nav>
      )}
      {fighterComparison && (
        <nav
          aria-label="Fighter projectiles"
          style="display:flex;gap:18px;padding:4px 12px 12px;font:13px monospace"
        >
          {FIGHTER_PROJECTILE_KINDS.map((kind) => (
            <a key={kind} style="color:#ffc77a" href={fighterLink('rangedControl', kind)}>
              {FIGHTER_PROJECTILE_CATALOG[kind].name}
            </a>
          ))}
        </nav>
      )}
      {adventureComparison && (
        <nav
          style="display:flex;gap:20px;padding:12px;font:14px monospace"
          aria-label="Adventure play styles"
        >
          {ADVENTURE_PLAY_STYLES.map((style) => (
            <a key={style} style="color:#aee9f1" href={`/?dev=playtest&adventureStyle=${style}`}>
              {ADVENTURE_STYLE_CATALOG[style].name}
            </a>
          ))}
        </nav>
      )}
      {shooterComparison && (
        <nav
          style="display:flex;gap:20px;padding:12px;font:14px monospace"
          aria-label="Shooter play styles"
        >
          {SHOOTER_PLAY_STYLES.map((style) => (
            <a key={style} style="color:#aee9f1" href={`/?dev=playtest&shooterStyle=${style}`}>
              {SHOOTER_STYLE_CATALOG[style].name}
            </a>
          ))}
        </nav>
      )}
      {comparison && !fighterComparison && !shooterComparison && !adventureComparison && (
        <nav
          style="display:flex;gap:20px;padding:12px;color:white;font:14px monospace"
          aria-label="Platformer play styles"
        >
          {PLATFORMER_PLAY_STYLES.map((style) => (
            <a
              key={style}
              style="color:#aee9f1"
              href={`/?dev=playtest&style=${style}${new URLSearchParams(location.search).has('actionRun') ? `&actionRun=${encodeURIComponent(new URLSearchParams(location.search).get('actionRun')!)}` : ''}`}
            >
              {PLATFORMER_STYLE_CATALOG[style].name}
            </a>
          ))}
        </nav>
      )}
      {artNote && <div style="color:#aab3d5;font:12px monospace;padding-bottom:6px">{artNote}</div>}
      {error ? (
        <div style="color:#ff6170;font:20px monospace">{error}</div>
      ) : (
        <canvas
          ref={ref}
          style={
            comparison
              ? `image-rendering:pixelated;width:min(1024px,100vw,calc((100vh - ${fighterComparison ? 104 : 64}px) * 1.706667));height:auto;aspect-ratio:1024/600`
              : 'image-rendering:pixelated;width:1024px;height:600px'
          }
          tabIndex={0}
        />
      )}
    </div>
  );
}
