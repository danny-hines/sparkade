export interface ShooterCombatCheck {
  title: string;
  style: string;
  results: { name: string; pass: boolean; damage?: number; hp?: number[] }[];
}
export function checkShooterCombat(): ShooterCombatCheck;
export function checkShooterTimeline(): {
  title: string;
  style: string;
  stagesVisited: number[];
  outcome?: string;
  simulatedSeconds: number;
  peaks: { enemies: number; playerShots: number; enemyShots: number };
  invulnerablePilot: boolean;
  pass: boolean;
};
