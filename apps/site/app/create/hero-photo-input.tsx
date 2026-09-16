'use client';
import { useEffect, useRef, useState } from 'react';
import { decodePhotoFileToJpeg, squareCrop, uploadOutputSize } from '@sparkade/web/photo-upload';
import { MAX_WEBSITE_PHOTO_BYTES } from '@/lib/website-photo-limits';

type Mode = 'idle' | 'reading' | 'starting' | 'camera' | 'capturing';
export function HeroPhotoInput({
  photo,
  onChange,
  onBusyChange,
}: {
  photo: Blob | null;
  onChange: (photo: Blob | null) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [mode, setMode] = useState<Mode>('idle');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState('');
  const [cameraReady, setCameraReady] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const sequence = useRef(0);
  const cameraOpen = mode === 'starting' || mode === 'camera' || mode === 'capturing';

  function stopCamera() {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
  }
  function changeMode(next: Mode) {
    setMode(next);
    onBusyChange(next !== 'idle');
  }
  function cancel() {
    sequence.current++;
    stopCamera();
    setCameraReady(false);
    changeMode('idle');
  }
  useEffect(() => {
    return () => {
      sequence.current++;
      stopCamera();
    };
  }, []);
  useEffect(() => {
    if (!photo) {
      setPreview('');
      return;
    }
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  function acceptPhoto(blob: Blob) {
    if (blob.size > MAX_WEBSITE_PHOTO_BYTES)
      throw new Error('That photo is too detailed to submit. Please choose another image.');
    onChange(blob);
    stopCamera();
    changeMode('idle');
  }
  async function upload(file?: File) {
    if (!file) return;
    cancel();
    const current = ++sequence.current;
    setError('');
    changeMode('reading');
    try {
      const blob = await decodePhotoFileToJpeg(file, {
        isCancelled: () => current !== sequence.current,
      });
      if (current === sequence.current) acceptPhoto(blob);
    } catch (err) {
      if (current !== sequence.current) return;
      setError(err instanceof Error ? err.message : 'Could not read that photo.');
      changeMode('idle');
    }
  }
  async function openCamera() {
    cancel();
    setError('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(
        'Camera access needs HTTPS and a supported browser. You can upload a photo instead.',
      );
      return;
    }
    const current = ++sequence.current;
    changeMode('starting');
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      if (current !== sequence.current) {
        media.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = media;
      if (video.current) {
        video.current.srcObject = media;
        await video.current.play();
      }
      if (current === sequence.current) changeMode('camera');
    } catch (err) {
      if (current !== sequence.current) return;
      stopCamera();
      const denied = err instanceof Error && err.name === 'NotAllowedError';
      setError(
        denied
          ? 'Camera access was denied. Allow access in your browser or upload a photo.'
          : 'Could not open your camera. Check that it is connected and not in use, or upload a photo.',
      );
      changeMode('idle');
    }
  }
  async function capture() {
    const source = video.current;
    if (!source?.videoWidth || !source.videoHeight) return;
    const current = sequence.current;
    changeMode('capturing');
    try {
      const crop = squareCrop(source.videoWidth, source.videoHeight);
      const size = uploadOutputSize(crop.side);
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Could not take a photo. Try uploading one instead.');
      context.drawImage(source, crop.sx, crop.sy, crop.side, crop.side, 0, 0, size, size);
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (result) =>
            result ? resolve(result) : reject(new Error('Could not capture that photo.')),
          'image/jpeg',
          0.85,
        );
      });
      if (current === sequence.current) acceptPhoto(blob);
    } catch (err) {
      if (current !== sequence.current) return;
      setError(err instanceof Error ? err.message : 'Could not capture that photo.');
      cancel();
    }
  }
  return (
    <section className="arc-hero-photo" aria-labelledby="hero-photo-label">
      <h2 id="hero-photo-label">
        Be the hero <span>(optional)</span>
      </h2>
      <p>Add a clear photo of yourself to inspire your hero’s appearance.</p>
      {cameraOpen ? (
        <div className="arc-photo-camera">
          <video
            ref={video}
            autoPlay
            muted
            playsInline
            aria-label="Live camera preview"
            onLoadedData={() => setCameraReady(true)}
          />
          <p role="status">
            {mode === 'starting' ? 'Waiting for camera access…' : 'Center your face in the frame.'}
          </p>
          <div className="arc-photo-actions">
            <button
              type="button"
              className="arc-button"
              onClick={capture}
              disabled={!cameraReady || mode !== 'camera'}
            >
              {mode === 'capturing' ? 'Taking photo…' : 'Capture photo'}
            </button>
            <button type="button" className="arc-button-secondary" onClick={cancel}>
              Cancel camera
            </button>
          </div>
        </div>
      ) : (
        <>
          {preview && (
            <img className="arc-photo-preview" src={preview} alt="Your selected hero photo" />
          )}
          <div className="arc-photo-actions">
            <button
              type="button"
              className="arc-button-secondary"
              onClick={() => picker.current?.click()}
              disabled={mode === 'reading'}
            >
              {photo ? 'Change photo' : 'Upload photo'}
            </button>
            <button
              type="button"
              className="arc-button-secondary"
              onClick={openCamera}
              disabled={mode === 'reading'}
            >
              {photo ? 'Retake photo' : 'Take photo'}
            </button>
            {photo && (
              <button
                type="button"
                className="arc-link-button"
                onClick={() => {
                  cancel();
                  onChange(null);
                  setError('');
                }}
              >
                Remove photo
              </button>
            )}
          </div>
        </>
      )}
      <input
        ref={picker}
        hidden
        type="file"
        accept="image/jpeg,image/png,image/webp"
        aria-label="Upload a hero photo"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          void upload(file);
        }}
      />
      {mode === 'reading' && <p role="status">Preparing your photo…</p>}
      {error && (
        <p className="arc-message" role="alert">
          {error}
        </p>
      )}
      <p className="arc-fine-print">
        JPEG, PNG, or WebP · up to 4 MB. Photos are cropped to a square.
      </p>
      <p className="arc-fine-print">
        Your photo is reviewed with your idea and used to create your game. The original stays
        private; your generated likeness can appear in the game you share.
      </p>
    </section>
  );
}
