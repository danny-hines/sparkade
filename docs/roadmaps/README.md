# Archetype roadmaps

Sparkade's game types share an engine, but each archetype needs its own gameplay vocabulary,
schema, validation, generation guidance, and runtime support. Keep forward-looking ideas in a
separate roadmap file for each archetype so they can be discussed and prioritized without turning
the general backlog into a mixture of unrelated game-design notes.

These documents describe possible directions, not committed release scope. Concrete bugs and
well-defined implementation tasks still belong in [`../BACKLOG.md`](../BACKLOG.md).

## Roadmaps

- [Platformer](platformer.md)
- [Adventure](adventure.md)
- [Vertical Shooter](shooter.md)
- [H-Scroll Shooter](hshooter.md)

Add another `<archetype>.md` file when there is enough archetype-specific direction to preserve,
then link it here. Prefer reusable systems and authorable data over lists of hard-coded special
cases; each proposed lever should eventually identify its schema, validation, runtime, prompt, and
testing implications.
