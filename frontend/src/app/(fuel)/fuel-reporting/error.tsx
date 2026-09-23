'use client';

export default function FuelPortalError({ reset }: { reset: () => void }) {
  return (
    <main className="fp-access" role="alert">
      <h1>Unable to open Fuel Reporting</h1>
      <p>Something went wrong while loading this page. Try again to return to your station.</p>
      <button type="button" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
