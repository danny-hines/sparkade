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

- Have Muse Spark choose one roster-wide proportion and rendering aesthetic (for example, cartoony
  or realistic) and carry that contract through every player and enemy image prompt.
- Establish the player's canonical outfit during story/design generation, then reuse the same
  concrete outfit identity in story cards, presentation art, and gameplay pose generation.
- Give walking immediate motion by alternating the idle and walk states; later evaluate whether a
  second dedicated walk frame is worth the extra generation cost.
- Generate arena backgrounds and a small set of premise-specific backdrop props.
- Profile Fighter generation latency and spend, then reduce redundant image/review work through
  bounded candidates, checkpoint reuse, batching, and parallelism without lowering output quality.
