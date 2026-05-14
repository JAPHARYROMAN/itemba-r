type BrandVisualVariant =
  | 'group'
  | 'operations'
  | 'fuel'
  | 'trade'
  | 'logistics'
  | 'corridor'
  | 'hardware'
  | 'estate'
  | 'hospitality'
  | 'parking';

type BrandVisualProps = {
  variant: BrandVisualVariant;
  label: string;
  className?: string;
};

const palettes: Record<BrandVisualVariant, { bg: string; accent: string; soft: string }> = {
  group: { bg: 'from-ink-950 via-ink-900 to-slate-800', accent: '#c8860a', soft: '#f0cc6a' },
  operations: { bg: 'from-ink-950 via-slate-900 to-emerald-950', accent: '#10b981', soft: '#f0cc6a' },
  fuel: { bg: 'from-amber-950 via-ink-900 to-ink-950', accent: '#f59e0b', soft: '#fbbf24' },
  trade: { bg: 'from-blue-950 via-ink-900 to-ink-950', accent: '#3b82f6', soft: '#60a5fa' },
  logistics: { bg: 'from-emerald-950 via-ink-900 to-ink-950', accent: '#10b981', soft: '#34d399' },
  corridor: { bg: 'from-slate-950 via-ink-900 to-blue-950', accent: '#c8860a', soft: '#60a5fa' },
  hardware: { bg: 'from-slate-950 via-ink-900 to-amber-950', accent: '#f59e0b', soft: '#94a3b8' },
  estate: { bg: 'from-slate-950 via-ink-900 to-cyan-950', accent: '#22d3ee', soft: '#cbd5e1' },
  hospitality: { bg: 'from-rose-950 via-ink-900 to-ink-950', accent: '#f43f5e', soft: '#fbbf24' },
  parking: { bg: 'from-ink-950 via-slate-900 to-emerald-950', accent: '#10b981', soft: '#cbd5e1' },
};

function FuelArtwork({ accent, soft }: { accent: string; soft: string }) {
  return (
    <>
      <rect x="170" y="160" width="140" height="250" rx="20" fill="none" stroke={accent} strokeWidth="16" />
      <rect x="205" y="200" width="70" height="58" rx="8" fill={soft} opacity="0.9" />
      <path d="M310 230h54c28 0 48 22 48 50v70c0 26 18 44 44 44h8" fill="none" stroke={accent} strokeWidth="14" strokeLinecap="round" />
      <path d="M470 218c36 48 62 90 62 130 0 48-34 82-82 82s-82-34-82-82c0-40 26-82 62-130 11-15 29-15 40 0z" fill={accent} opacity="0.26" />
      <path d="M156 436h440" stroke={soft} strokeWidth="12" strokeLinecap="round" opacity="0.55" />
    </>
  );
}

function TradeArtwork({ accent, soft }: { accent: string; soft: string }) {
  return (
    <>
      <path d="M122 252l218-110 218 110v186H122V252z" fill="none" stroke={accent} strokeWidth="16" strokeLinejoin="round" />
      <path d="M168 300h344M168 358h344" stroke={soft} strokeWidth="10" strokeLinecap="round" opacity="0.75" />
      <rect x="190" y="320" width="62" height="38" rx="6" fill={accent} opacity="0.36" />
      <rect x="286" y="276" width="74" height="80" rx="8" fill={soft} opacity="0.32" />
      <rect x="398" y="320" width="72" height="38" rx="6" fill={accent} opacity="0.42" />
      <rect x="228" y="376" width="86" height="44" rx="8" fill={soft} opacity="0.26" />
      <rect x="378" y="376" width="86" height="44" rx="8" fill={accent} opacity="0.34" />
    </>
  );
}

function LogisticsArtwork({ accent, soft }: { accent: string; soft: string }) {
  return (
    <>
      <path d="M92 432h516" stroke={soft} strokeWidth="14" strokeLinecap="round" opacity="0.7" />
      <path d="M138 380h246V250H170c-18 0-32 14-32 32v98z" fill="none" stroke={accent} strokeWidth="16" strokeLinejoin="round" />
      <path d="M384 302h82l74 78v52H384V302z" fill="none" stroke={accent} strokeWidth="16" strokeLinejoin="round" />
      <circle cx="220" cy="434" r="34" fill="none" stroke={soft} strokeWidth="14" />
      <circle cx="466" cy="434" r="34" fill="none" stroke={soft} strokeWidth="14" />
      <path d="M184 280h142M184 318h142M184 356h92" stroke={soft} strokeWidth="10" strokeLinecap="round" opacity="0.55" />
      <path d="M438 322h40l36 38h-76v-38z" fill={soft} opacity="0.35" />
    </>
  );
}

function CorridorArtwork({ accent, soft }: { accent: string; soft: string }) {
  return (
    <>
      <path d="M278 476l76-336M422 476l-76-336" stroke={accent} strokeWidth="16" strokeLinecap="round" />
      <path d="M350 174v42M350 258v42M350 342v42" stroke={soft} strokeWidth="10" strokeLinecap="round" opacity="0.8" />
      <path d="M92 382c74-42 130-52 204-30M406 300c72-34 124-32 202 4" stroke={soft} strokeWidth="10" strokeLinecap="round" opacity="0.35" />
      <circle cx="162" cy="182" r="36" fill={accent} opacity="0.3" />
      <circle cx="540" cy="226" r="24" fill={soft} opacity="0.4" />
    </>
  );
}

function HardwareArtwork({ accent, soft }: { accent: string; soft: string }) {
  return (
    <>
      <path d="M190 386l196-196" stroke={accent} strokeWidth="24" strokeLinecap="round" />
      <path d="M388 158l72 72-38 38-72-72 38-38z" fill={soft} opacity="0.45" />
      <path d="M172 230h190M172 286h142M172 342h96" stroke={soft} strokeWidth="12" strokeLinecap="round" opacity="0.56" />
      <rect x="128" y="184" width="132" height="230" rx="18" fill="none" stroke={accent} strokeWidth="14" opacity="0.72" />
      <path d="M440 334l52 52M492 334l-52 52" stroke={soft} strokeWidth="14" strokeLinecap="round" opacity="0.75" />
    </>
  );
}

function EstateArtwork({ accent, soft }: { accent: string; soft: string }) {
  return (
    <>
      <rect x="144" y="240" width="130" height="200" rx="10" fill="none" stroke={accent} strokeWidth="14" />
      <rect x="330" y="178" width="170" height="262" rx="10" fill="none" stroke={soft} strokeWidth="14" opacity="0.75" />
      <path d="M170 288h78M170 334h78M170 380h78M362 228h106M362 276h106M362 324h106M362 372h106" stroke={accent} strokeWidth="9" strokeLinecap="round" opacity="0.5" />
      <path d="M106 440h500" stroke={soft} strokeWidth="12" strokeLinecap="round" opacity="0.45" />
    </>
  );
}

function HospitalityArtwork({ accent, soft }: { accent: string; soft: string }) {
  return (
    <>
      <rect x="126" y="282" width="430" height="118" rx="18" fill="none" stroke={accent} strokeWidth="16" />
      <path d="M126 344h430M178 282v-58h126c34 0 62 26 62 58" stroke={soft} strokeWidth="14" strokeLinecap="round" opacity="0.72" />
      <rect x="184" y="242" width="86" height="40" rx="12" fill={accent} opacity="0.34" />
      <path d="M164 400v48M518 400v48" stroke={soft} strokeWidth="14" strokeLinecap="round" opacity="0.65" />
      <circle cx="510" cy="208" r="34" fill={accent} opacity="0.26" />
    </>
  );
}

function GroupArtwork({ accent, soft }: { accent: string; soft: string }) {
  return (
    <>
      <circle cx="350" cy="190" r="54" fill={accent} opacity="0.35" />
      <circle cx="206" cy="372" r="54" fill={soft} opacity="0.3" />
      <circle cx="494" cy="372" r="54" fill={soft} opacity="0.3" />
      <path d="M320 224L236 332M380 224l84 108M260 372h180" stroke={accent} strokeWidth="14" strokeLinecap="round" opacity="0.8" />
      <rect x="142" y="318" width="128" height="108" rx="16" fill="none" stroke={soft} strokeWidth="12" />
      <rect x="286" y="136" width="128" height="108" rx="16" fill="none" stroke={accent} strokeWidth="12" />
      <rect x="430" y="318" width="128" height="108" rx="16" fill="none" stroke={soft} strokeWidth="12" />
    </>
  );
}

function OperationsArtwork({ accent, soft }: { accent: string; soft: string }) {
  return (
    <>
      <path d="M170 180h160v112H170zM370 180h160v112H370zM170 342h160v112H170zM370 342h160v112H370z" fill="none" stroke={accent} strokeWidth="14" strokeLinejoin="round" opacity="0.82" />
      <path d="M250 292v50M450 292v50M330 236h40M330 398h40" stroke={soft} strokeWidth="12" strokeLinecap="round" opacity="0.75" />
      <circle cx="250" cy="236" r="28" fill={soft} opacity="0.3" />
      <circle cx="450" cy="236" r="28" fill={soft} opacity="0.3" />
      <circle cx="250" cy="398" r="28" fill={soft} opacity="0.3" />
      <circle cx="450" cy="398" r="28" fill={soft} opacity="0.3" />
    </>
  );
}

function renderArtwork(variant: BrandVisualVariant, palette: { accent: string; soft: string }) {
  if (variant === 'fuel') return <FuelArtwork {...palette} />;
  if (variant === 'trade') return <TradeArtwork {...palette} />;
  if (variant === 'logistics' || variant === 'parking') return <LogisticsArtwork {...palette} />;
  if (variant === 'corridor') return <CorridorArtwork {...palette} />;
  if (variant === 'hardware') return <HardwareArtwork {...palette} />;
  if (variant === 'estate') return <EstateArtwork {...palette} />;
  if (variant === 'hospitality') return <HospitalityArtwork {...palette} />;
  if (variant === 'operations') return <OperationsArtwork {...palette} />;
  return <GroupArtwork {...palette} />;
}

export default function BrandVisual({ variant, label, className = '' }: BrandVisualProps) {
  const palette = palettes[variant];
  const positionStyle = className.includes('absolute') ? { position: 'absolute' as const } : undefined;

  return (
    <div
      role="img"
      aria-label={label}
      className={`relative overflow-hidden bg-gradient-to-br ${palette.bg} ${className}`}
      style={positionStyle}
    >
      <div className="absolute inset-0 grid-overlay opacity-50" />
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 700 560" fill="none" aria-hidden="true">
        <circle cx="610" cy="50" r="210" fill={palette.accent} opacity="0.12" />
        <circle cx="90" cy="510" r="180" fill={palette.soft} opacity="0.08" />
        <path d="M80 482C206 424 314 412 462 454c64 18 112 14 162-8" stroke="white" strokeWidth="8" opacity="0.06" strokeLinecap="round" />
        <g transform="translate(0 0)">{renderArtwork(variant, palette)}</g>
      </svg>
    </div>
  );
}
