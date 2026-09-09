export interface ShooterTarget {
  key: string;
  x: number;
  y: number;
}

export const SHOOTER_LOCK_TIME_S = 0.32;
export const SHOOTER_MAX_LOCKS = 4;

/** Locks belong to a spawn, not its reusable pool slot. Leaving the field drops a lock. */
export class ShooterLocks {
  keys: string[] = [];
  progress = 0;
  private acquiring: string | null = null;

  clear(): void {
    this.keys = [];
    this.progress = 0;
    this.acquiring = null;
  }

  update(dt: number, targets: readonly ShooterTarget[], x: number, y: number): void {
    const available = targets.filter((target) => {
      const ahead = y - target.y;
      return (
        ahead >= 12 && ahead <= 260 && Math.abs(target.x - x) <= Math.min(160, 50 + ahead * 0.55)
      );
    });
    this.keys = this.keys.filter((key) => available.some((target) => target.key === key));
    if (!available.length || this.keys.length >= SHOOTER_MAX_LOCKS) {
      this.progress = 0;
      this.acquiring = null;
      return;
    }
    // Distribute across the screen before adding another missile to the same target.
    const count = (key: string) => this.keys.filter((locked) => locked === key).length;
    available.sort(
      (a, b) =>
        count(a.key) - count(b.key) ||
        Math.abs(a.x - x) - Math.abs(b.x - x) ||
        a.key.localeCompare(b.key),
    );
    const key = available[0]!.key;
    if (key !== this.acquiring) this.progress = 0;
    this.acquiring = key;
    this.progress += dt;
    if (this.progress >= SHOOTER_LOCK_TIME_S) {
      this.keys.push(key);
      this.progress = 0;
      this.acquiring = null;
    }
  }
}

/** Attack burst followed by a readable, finite opening. Old unstyled saves retain cadence. */
export function shooterBossOpening(t: number, styled: boolean): boolean {
  return styled && t >= 2 && (t - 2) % 7.2 >= 4.8;
}
