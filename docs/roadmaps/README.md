# Archetype roadmaps

Sparkade's game types share an engine, but each archetype needs its own gameplay vocabulary,
schema, validation, generation guidance, and runtime support. Keep forward-looking ideas in a
separate roadmap file for each archetype so they can be discussed and prioritized without turning
the general backlog into a mixture of unrelated game-design notes.

These documents describe possible directions, not committed release scope. Concrete bugs and
well-defined implementation tasks still belong in [`../BACKLOG.md`](../BACKLOG.md).

## Roadmaps

- [Game uniqueness: cross-archetype catalogue and priorities](game-uniqueness.md)
- [Platformer](platformer.md)
- [Platformer encounter composition and fairness](platformer-encounters.md)
- [Adventure](adventure.md)
- [Vertical Shooter](shooter.md)
- [H-Scroll Shooter](hshooter.md)
- [Fighter](fighter.md)

Add another `<archetype>.md` file when there is enough archetype-specific direction to preserve,
then link it here. Prefer reusable systems and authorable data over lists of hard-coded special
cases; each proposed lever should eventually identify its schema, validation, runtime, prompt, and
testing implications.

## Online product and infrastructure

- [Online generation: friends beta, credits, and editing](online-generation.md)
- [Website experience: Home, Play, and Profile](website-experience.md)
- [Generation on Vercel: runtime and rollout](cloud-generation.md)
- [Sprite generation: SAM masks, interchangeable recipes, and video animation](sprite-generation.md)
