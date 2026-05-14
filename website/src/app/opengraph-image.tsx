import { ImageResponse } from 'next/og';
import { site } from '@/lib/site';

export const runtime = 'edge';
export const alt = "Itemba Group - Tanzania's Diversified Business Group";
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '64px',
          background: 'linear-gradient(135deg, #05080f 0%, #080f1e 48%, #122035 100%)',
          color: '#ffffff',
          fontFamily: 'Arial, sans-serif',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            width: '620px',
            height: '620px',
            borderRadius: '50%',
            background: 'rgba(200, 134, 10, 0.22)',
            filter: 'blur(90px)',
            right: '-170px',
            top: '-220px',
          }}
        />
        <div
          style={{
            position: 'absolute',
            width: '540px',
            height: '540px',
            borderRadius: '50%',
            background: 'rgba(16, 185, 129, 0.14)',
            filter: 'blur(90px)',
            left: '-160px',
            bottom: '-220px',
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '18px' }}>
            <div
              style={{
                width: '72px',
                height: '72px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '14px',
                background: '#c8860a',
                color: '#05080f',
                fontSize: '34px',
                fontWeight: 900,
              }}
            >
              IG
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ fontSize: '32px', fontWeight: 800 }}>{site.name}</div>
              <div style={{ color: '#f0cc6a', fontSize: '18px', marginTop: '4px' }}>
                Mpemba-Tunduma - Songwe Region - Tanzania
              </div>
            </div>
          </div>
        </div>
        <div
          style={{
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            maxWidth: '880px',
          }}
        >
          <div
            style={{
              color: '#f0cc6a',
              fontSize: '20px',
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              marginBottom: '24px',
            }}
          >
            Diversified Business Group
          </div>
          <div style={{ fontSize: '74px', lineHeight: 0.94, fontWeight: 900, letterSpacing: '-0.03em' }}>
            Energy. Trade. Logistics. Hospitality.
          </div>
          <div style={{ color: '#cbd5e1', fontSize: '26px', lineHeight: 1.35, marginTop: '30px' }}>
            Three independent companies, six business sectors, one unified vision.
          </div>
        </div>
        <div style={{ color: '#94a3b8', fontSize: '20px' }}>{site.domain}</div>
      </div>
    ),
    size
  );
}
