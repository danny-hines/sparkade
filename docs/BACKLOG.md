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
