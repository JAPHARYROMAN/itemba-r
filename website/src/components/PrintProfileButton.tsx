'use client';

export default function PrintProfileButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="print-hidden btn-primary inline-flex rounded-full bg-gold-500 px-6 py-3 text-sm font-semibold text-white hover:bg-gold-400"
    >
      Print profile
    </button>
  );
}
