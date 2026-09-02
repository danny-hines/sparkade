import { ImageResponse } from 'next/og';

export const alt = 'Sparkade — Your idea. Your arcade.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        position: 'relative',
        alignItems: 'center',
        overflow: 'hidden',
        color: '#f4f5ff',
        background: '#070912',
        fontFamily: 'Arial, sans-serif',
      }}
    >
      <div
        style={{
          position: 'absolute',
          width: 620,
          height: 620,
          right: -100,
          top: -120,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(8,125,255,.36), rgba(7,9,18,0) 67%)',
        }}
      />
      <div style={{ display: 'flex', flexDirection: 'column', padding: 88 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18, fontSize: 29 }}>
          <div
            style={{
              width: 34,
              height: 34,
              display: 'flex',
              transform: 'rotate(45deg)',
              border: '3px solid #38e5ff',
            }}
          />
          <span style={{ fontWeight: 700, letterSpacing: 3 }}>SPARKADE</span>
        </div>
        <div
          style={{
            maxWidth: 900,
            marginTop: 75,
            display: 'flex',
            flexDirection: 'column',
            fontSize: 84,
            fontWeight: 700,
            letterSpacing: -5,
            lineHeight: 1.02,
          }}
        >
          <span>Your idea.</span>
          <span style={{ color: '#ff9a2a' }}>Your arcade.</span>
        </div>
        <div style={{ marginTop: 38, color: '#b4bbd7', fontSize: 27 }}>
          A self-generating arcade, coming soon.
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          right: 130,
          bottom: 105,
          width: 170,
          height: 170,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transform: 'rotate(45deg)',
          border: '3px solid rgba(56,229,255,.5)',
        }}
      >
        <div style={{ width: 94, height: 22, display: 'flex', background: '#ff9a2a' }} />
        <div
          style={{
            position: 'absolute',
            width: 22,
            height: 94,
            display: 'flex',
            background: '#ff9a2a',
          }}
        />
      </div>
    </div>,
    size,
  );
}
