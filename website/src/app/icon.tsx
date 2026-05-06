import { ImageResponse } from 'next/og';

export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          fontSize: 18,
          background: '#080f1e',
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#c8860a',
          fontWeight: 900,
          letterSpacing: '-0.05em',
          fontFamily: 'sans-serif',
          borderRadius: '6px',
        }}
      >
        IG
      </div>
    ),
    { ...size }
  );
}
