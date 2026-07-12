// Pooled particle system with a hard cap; zero allocations after construction.
import { BUDGET } from '@sparkade/shared';
import type { Renderer } from './renderer';

interface Particle {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  gravity: number;
}

export class ParticleSystem {
  private pool: Particle[];
  private cap: number;
  private cursor = 0;
  alive = 0;

  constructor() {
    this.cap = BUDGET.maxParticles;
    this.pool = Array.from({ length: BUDGET.maxParticles }, () => ({
      active: false,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      life: 0,
      maxLife: 0,
      size: 1,
      color: '#ffffff',
      gravity: 0,
    }));
  }

  /** Degrade gracefully: halve the live budget when the host reports low FPS. */
  setBudgetScale(scale: number): void {
    this.cap = Math.max(16, Math.floor(BUDGET.maxParticles * scale));
  }

  burst(
    x: number,
    y: number,
    count: number,
    opts: {
      color?: string;
      speed?: number;
      life?: number;
      size?: number;
      gravity?: number;
      spread?: number;
      angle?: number;
    } = {},
  ): void {
    const speed = opts.speed ?? 80;
    const life = opts.life ?? 0.5;
    for (let i = 0; i < count; i++) {
      if (this.alive >= this.cap) return;
      const p = this.claim();
      if (!p) return;
      const a =
        opts.angle !== undefined
          ? opts.angle + (Math.random() - 0.5) * (opts.spread ?? Math.PI / 3)
          : Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.6);
      p.active = true;
      p.x = x;
      p.y = y;
      p.vx = Math.cos(a) * s;
      p.vy = Math.sin(a) * s;
      p.life = life * (0.6 + Math.random() * 0.4);
      p.maxLife = p.life;
      p.size = opts.size ?? 2;
      p.color = opts.color ?? '#ffffff';
      p.gravity = opts.gravity ?? 160;
      this.alive++;
    }
  }

  private claim(): Particle | null {
    for (let i = 0; i < this.pool.length; i++) {
      this.cursor = (this.cursor + 1) % this.pool.length;
      const p = this.pool[this.cursor]!;
      if (!p.active) return p;
    }
    return null;
  }

  update(dt: number): void {
    for (const p of this.pool) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        this.alive--;
        continue;
      }
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  render(r: Renderer, camX: number, camY: number): void {
    for (const p of this.pool) {
      if (!p.active) continue;
      const t = p.life / p.maxLife;
      const size = t > 0.5 ? p.size : Math.max(1, p.size - 1);
      r.rect(p.x - camX - size / 2, p.y - camY - size / 2, size, size, p.color);
    }
  }

  clear(): void {
    for (const p of this.pool) p.active = false;
    this.alive = 0;
  }
}
