# Spark Token Rally generation

This built-in was created through Sparkade's New Game wizard using the normal production generation pipeline. Its published game specification and 17 manifest-listed assets were initially copied unchanged into the golden fixture. The player vehicle strip was subsequently regenerated through Sparkade to correct its camera elevation; the specification and other 16 assets remain unchanged.

## User inputs

- Hero name: Tom
- Game type: Racing
- Photo: user-supplied portrait, processed by the wizard's normal photo upload flow. The source photo is not included in the built-in assets.
- Details:

> Call it Friend Prix. Tom brings scattered neighborhoods together for a Friendship Festival in a playful Facebook-inspired racing cup. Use only Tom as his name, never a surname. Match the uploaded photo faithfully in every portrait and story image: mature clean-shaven face, close-cropped dark hair, high forehead and receding temples, blue eyes, wide friendly smile; no quiff or younger generic hero. Tom wears a blue-and-ivory racing jacket in an open-cockpit cobalt-and-ivory hover roadster, with his face visible. Three scenic races: sunny Neighborhood Loop, turquoise Creator Coast, and a sapphire-and-gold Festival Circuit with fireworks. Four friendly fictional rivals: PATCH, REEL, PING, LOOP, in coral, violet, mint, and charcoal-gold roadsters. Three laps per race; collectible golden Spark Tokens charge boost. Make it approachable and lively, with corners, coastal ramps, and a finale fork. Rich 16-bit pixel art, distinct panoramas and landmarks, upbeat chiptunes, and a short warm story about finding your people. No combat; LOOP is a friendly finale champion.

## Generation

- Game ID: `g-gotsczlzks`
- Job ID: `j-5lj86ktLI7lG`
- Text model: `muse-spark-1.3-contributor`
- Image model: `muse-image-1.0`
- The normal duplicate-title check changed the requested Friend Prix title to Spark Token Rally.
- Two normal Retry actions recovered image-provider refusals during rival banking corrections. The completed design, music, photo likeness, and artwork were restored by Sparkade's checkpoints. The final roster passed the normal semantic art review.
- No session image-generator outputs, authored game-spec overrides, or manually approved assets are used in this fixture.

## Player vehicle camera correction

The original player strip pointed away but showed an overhead view, unlike the rear chase-camera composition required for gameplay. The replacement was generated with Sparkade's configured `muse-image-1.0` adapter, using a rival's rear view as a camera reference. Sparkade's foundation processor produced one neutral rear view; its normal two-pose bank editor generated separate left and right rolls. The temporary repeated-neutral strip was never installed as finished turning art.

The updated production roster judge (`muse-spark-1.3-contributor`) accepted the new strip with all three camera views classified `low-rear`. A separate regression review rejected the original strip as `overhead` in all three cells and requested a vehicle repaint. No manual semantic approval was substituted.

- Final player SHA-256: `48af5cc9894e27ba0ef56af87320df87b068aec9b7436b6e38490e84cd6f2985`
- Prompt version: `racing-traversal-strip-v4-rear-camera-correction-v1`
- Local generation/review records: `scratch/friend-prix/rear-camera/attempt-4` (neutral source), `attempt-5` (bank edits and final review), and `regression` (old strip rejection). These scratch records are not shipped assets.

## Verification

The generated specification passed schema, security, sprite, and archetype checks with no remaining repairs. A deterministic simulation completed all three three-lap races without a DNF. The built-in source and installed copy preserve the generated specification and the 16 unchanged assets byte for byte. The replacement player strip is verified against its updated manifest hash.
