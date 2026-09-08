/** Small palette pixels on the world grid, without antialiased paths or solid glow discs. */
export function drawPixelCharge(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  amount: number,
  time: number,
  flying: boolean,
  arcane: boolean,
  palette: readonly string[],
): void {
  const frame = Math.floor(time * 12);
  const radius = Math.round((flying ? 6 : 2 + amount * 3) + (frame % 3 === 0 ? 1 : 0));
  const color = palette[arcane ? 8 : 5]!;
  x = Math.round(x);
  y = Math.round(y);
  ctx.save();
  for (let py = -radius - 2; py <= radius + 2; py++)
    for (let px = -radius - 2; px <= radius + 2; px++) {
      const distance = arcane ? Math.abs(px) + Math.abs(py) : Math.hypot(px, py);
      const pattern = (((px * 13 + py * 17 + frame * 7) % 11) + 11) % 11;
      if (distance > radius + 2 || (distance > 1 && pattern > (distance < radius ? 5 : 1)))
        continue;
      ctx.globalAlpha = distance > radius ? 0.45 : 0.85;
      ctx.fillStyle = distance <= 1 ? palette[15]! : pattern < 2 ? palette[13]! : color;
      ctx.fillRect(x + px, y + py, 1, 1);
    }
  for (let i = 0; i < 7; i++) {
    const orbit = (i * Math.PI * 2) / 7 + frame * 0.12 * (arcane ? -1 : 1);
    const progress = (time * 1.7 + i / 7) % 1;
    const distance = radius + (1 - progress) * (5 + amount * 6);
    ctx.globalAlpha = (0.25 + progress * 0.65) * amount;
    ctx.fillStyle = i % 3 ? color : palette[15]!;
    ctx.fillRect(
      Math.round(x + Math.cos(orbit) * distance),
      Math.round(y + Math.sin(orbit) * distance),
      1,
      1,
    );
  }
  ctx.restore();
}

/** Three short, broken wave frames; the airborne sweep also marks the feet. */
export function drawPixelStrike(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  feetY: number,
  facing: number,
  remaining: number,
  descending: boolean,
  palette: readonly string[],
): void {
  const active = remaining <= 0.36;
  const frame = Math.min(2, Math.floor(((0.36 - remaining) / 0.16) * 3));
  x = Math.round(x);
  y = Math.round(y);
  ctx.save();
  if (!active) {
    ctx.fillStyle = palette[13]!;
    ctx.globalAlpha = 0.65;
    for (const [dx, dy] of [
      [10, -3],
      [13, 0],
      [10, 3],
    ])
      ctx.fillRect(x + facing * dx!, y + dy!, 1, 1);
  } else {
    for (let i = 0; i < 13; i++) {
      const dy = (i - 6) * 2;
      const dx = 27 + frame * 2 - Math.floor((dy * dy) / 18);
      ctx.globalAlpha = 0.75;
      ctx.fillStyle = i % 4 === frame ? palette[14]! : palette[13]!;
      ctx.fillRect(x + facing * dx, y + dy, 1, i % 3 === frame ? 2 : 1);
      if (i % 2 === frame % 2) {
        ctx.globalAlpha = 0.3;
        ctx.fillRect(x + facing * (dx - 4), y + dy - 1, 2, 1);
      }
    }
    if (descending) {
      ctx.fillStyle = palette[13]!;
      ctx.globalAlpha = 0.7;
      for (let dx = -8; dx <= 8; dx += 2)
        ctx.fillRect(x + dx, Math.round(feetY) + 4 - Math.floor((dx * dx) / 24), 1, 1);
    }
  }
  ctx.restore();
}
