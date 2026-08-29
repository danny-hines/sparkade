# Deferred work

## Platformer entity reachability

The platformer route validator currently proves that the player can reach the exit, but it does not
prove that every pickup, power-up, spring, or enemy occupies a useful reachable space. Generated
levels can therefore remain completable while optional content is trapped in sealed terrain pockets
or otherwise impossible to interact with.

When this work resumes:

- Validate entity placement against the same reachable standing-cell set and player jump kernel
  used for the exit route.
- Require collectibles, health, and power-ups to have a reachable collection position.
- Require grounded enemies to have reachable encounter space and enough clear terrain for their
  movement behavior; treat flying enemies according to their actual interaction envelope.
- Account for one-way platforms, springs, and moving-platform travel when determining access.
- Repair invalid placements by moving them to the nearest suitable reachable cell, not merely by
  lifting them vertically out of solid terrain.
- Add generated-level fixtures covering sealed pockets, blocked ledges, and items that are visually
  exposed but physically inaccessible.

This is a gameplay-quality follow-up, not a blocker for the current media-generation workstream.
