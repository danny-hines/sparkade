// Computes a generated platformer player's run in-betweens off the main
// thread. About 3.5 seconds per game on a Pi 3, so it must never block play.
import { buildRunInbetweens, type RgbaFrame } from '@sparkade/shared/run-inbetweens';

interface RunInbetweenRequest {
  walk1: RgbaFrame;
  sideIdle: RgbaFrame;
  walk2: RgbaFrame;
}

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<RunInbetweenRequest>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};

scope.onmessage = (event) => {
  try {
    const { runMid1, runMid2 } = buildRunInbetweens(event.data);
    scope.postMessage({ ok: true, runMid1, runMid2 }, [
      runMid1.data.buffer as ArrayBuffer,
      runMid2.data.buffer as ArrayBuffer,
    ]);
  } catch (error) {
    scope.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
