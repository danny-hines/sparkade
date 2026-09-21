# Generation fixtures

`racing-legacy.json` preserves the original Ember Cup as the mock provider's
stable hover-racing fixture: no rider traversal, hills, ramps, or forks, with
pad-based boost. Mock requests opt into those features explicitly, so changing
the curated starter game cannot silently change generation regression coverage.

Fixtures in this directory are not installed as built-in games. The shipped
racer is `../golden/golden-racing.json` (Spark Token Rally), with its adjacent art pack.
