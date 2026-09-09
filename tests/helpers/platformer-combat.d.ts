export interface CombatCheck {
  title: string;
  style: string;
  results: { name: string; pass: boolean; health: number }[];
}
export function checkPlatformerCombat(): CombatCheck;
export function checkAuthoredPlatformerTargets(): {
  title: string;
  results: { level: number; index: number; type: string; pass: boolean; attempts: number }[];
};
