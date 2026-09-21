/** Shared camera contract for every racing identity and generated pose. */
export const RACING_REAR_CAMERA =
  "LOW REAR CHASE CAMERA: directly behind the subject, looking almost horizontally toward the horizon, at roughly rear-body height with at most a shallow downward angle (about 10 degrees). The visible back/rear silhouette dominates; vehicle length is strongly foreshortened and the nose/hood is mostly hidden behind the rear. Only a small amount of roof, deck or cockpit top may show. For people, show the back of the head and torso, not mainly the crown. Never overhead, top-down, aerial, bird's-eye, isometric, front-facing or side-on. Pointing away alone does not establish the correct camera elevation. Preserve this camera height and foreshortening in every pose; banking changes roll only, never pitch or yaw.";

export const RACING_CAMERA_REVIEW =
  'Judge camera elevation separately from travel direction. Inspect the actual pixels of EACH target frame before judging the concept. In cameraViews, classify each frame in displayed order as low-rear, overhead, front, side, or unclear. Low-rear means the visible rear/back dominates with strongly foreshortened vehicle depth; small top surfaces are allowed. Overhead means roof, hood, deck, cockpit interior or head crown dominates, even if the subject points away. Do not infer camera from color, vehicle width alone, the concept text, or another row. Describe the visible rear-versus-top evidence in summary. Only low-rear passes; all other classifications are fatal. Matching a reference or consistently repeating the same overhead view never excuses the wrong elevation.';

export function racingCameraViewsSchema(frames: number): Record<string, unknown> {
  return {
    type: 'array',
    minItems: frames,
    maxItems: frames,
    items: { type: 'string', enum: ['low-rear', 'overhead', 'front', 'side', 'unclear'] },
  };
}

export function validRacingRearCamera(views: unknown, frames: number): boolean {
  return (
    Array.isArray(views) && views.length === frames && views.every((view) => view === 'low-rear')
  );
}
