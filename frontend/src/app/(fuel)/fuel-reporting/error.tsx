'use client';

export default function LegacyFuelError({ reset }: { reset: () => void }) {
  return (
    <main role="alert">
      <h1>Unable to open PetroDollar</h1>
      <p>Try again, or open PetroDollar from the ITEMBA OS desktop.</p>
      <button type="button" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
