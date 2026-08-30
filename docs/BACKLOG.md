# Deferred work

## Resolved: Platformer entity reachability

Status: implemented on 2026-08-29.

The platformer route validator currently proves that the player can reach the exit, but it does not
prove that every pickup, power-up, spring, or enemy occupies a useful reachable space. Generated
levels can therefore remain completable while optional content is trapped in sealed terrain pockets
or otherwise impossible to interact with.

The completed correction:

- Validates entity placement against the same standing-cell graph and jump kernel used for routes.
- Gives pickups a reachable collection envelope, grounded enemies usable encounter space, and
  flyers a sampled interaction envelope.
- Includes one-way surfaces, springs, and moving-platform travel in traversal.
- Moves invalid generated placements to the nearest suitable reachable cell while preserving their
  gameplay type and properties.
- Covers sealed pockets, moving-platform bridges, blocked encounter spaces, and every platformer
  entity family with deterministic regression fixtures.

Published games remain unchanged; the correction applies while normalizing newly generated specs.

## Fighter presentation follow-ups

Resolved on 2026-08-29: the design pass now locks one roster-wide aesthetic, proportion, and
rendering contract plus the player's exact canonical outfit. Those contracts feed presentation art,
story scenes, every roster prompt, and Spark's pose reviews. Walking alternates the idle and walk
states at runtime. One additional image call produces a locally split ladder/boss arena atlas with
premise-specific background props; invalid arena art falls back atomically to the procedural stage.

Remaining:

- Profile Fighter generation latency and spend, then reduce redundant image/review work through
  bounded candidates, checkpoint reuse, batching, and parallelism without lowering output quality.
