// Audio transcoding for STT: browsers record webm/opus (MediaRecorder), but
// audio-in APIs commonly accept only wav/mp3 (verified live: Meta's
// input_audio 400s on format:"webm"). ffmpeg is installed by the Pi
// installer; on dev machines it must be on PATH for voice transcription
// against providers that need the conversion.
import { spawn } from 'node:child_process';

export function needsWavTranscode(mime: string): boolean {
  return !/(wav|mpeg|mp3)/.test(mime);
}

/** Transcode any ffmpeg-readable audio to 16 kHz mono WAV via stdin/stdout. */
export function transcodeToWav(input: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', ['-i', 'pipe:0', '-f', 'wav', '-ar', '16000', '-ac', '1', 'pipe:1'], {
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const chunks: Buffer[] = [];
    ff.stdout.on('data', (c: Buffer) => chunks.push(c));
    ff.on('error', (e) =>
      reject(
        new Error(
          `ffmpeg is required to convert browser voice recordings for this provider (${e.message}). Install ffmpeg and retry.`,
        ),
      ),
    );
    ff.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`ffmpeg exited with ${code} while converting the recording`));
    });
    ff.stdin.on('error', () => {}); // ffmpeg may close stdin early on malformed input
    ff.stdin.write(input);
    ff.stdin.end();
  });
}
