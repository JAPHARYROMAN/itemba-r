import { ImageResponse } from 'next/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          background: '#080f1e',
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 38,
        }}
      >
        <div
          style={{
            width: 126,
            height: 138,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '8px solid #f0cc6a',
            borderRadius: '42px 42px 56px 56px',
            boxShadow: 'inset 0 0 0 5px rgba(255,255,255,0.9)',
            color: '#ffffff',
            fontSize: 96,
            fontWeight: 900,
            fontFamily: 'serif',
            lineHeight: 1,
          }}
        >
          I
        </div>
      </div>
    ),
    { ...size }
  );
}
