'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          minHeight: '100vh',
          margin: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
          background: '#0b0f17',
          color: '#e8eef7',
          padding: 24,
        }}
      >
        <main style={{ maxWidth: 560, textAlign: 'center' }}>
          <div style={{ fontSize: 14, opacity: 0.65, letterSpacing: 1.5, marginBottom: 8 }}>
            ITEMBA-R
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 600, margin: '0 0 12px' }}>
            Something went wrong.
          </h1>
          <p style={{ fontSize: 15, opacity: 0.8, margin: '0 0 18px' }}>
            An unexpected error escaped the application. Try again or return to the dashboard.
          </p>
          {error?.digest ? (
            <p style={{ fontSize: 12, opacity: 0.5, marginBottom: 18 }}>
              Reference: <code>{error.digest}</code>
            </p>
          ) : null}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button
              type="button"
              onClick={() => reset()}
              style={{
                padding: '10px 20px',
                background: '#3a82f7',
                color: 'white',
                border: 'none',
                borderRadius: 8,
                cursor: 'pointer',
                fontSize: 14,
                fontWeight: 500,
              }}
            >
              Try again
            </button>
            <a
              href="/dashboard"
              style={{
                padding: '10px 20px',
                background: 'transparent',
                color: '#e8eef7',
                border: '1px solid rgba(255,255,255,0.2)',
                borderRadius: 8,
                textDecoration: 'none',
                fontSize: 14,
                fontWeight: 500,
              }}
            >
              Go to dashboard
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
