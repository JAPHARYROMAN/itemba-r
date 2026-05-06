type IconName =
  | 'energy'
  | 'trade'
  | 'manufacturing'
  | 'construction'
  | 'hospitality'
  | 'realestate'
  | 'logistics';

interface Props {
  name: IconName;
  className?: string;
}

const paths: Record<IconName, React.ReactNode> = {
  energy: (
    <>
      <path d="M13 2L4.5 14h7L11 22l8.5-12h-7L13 2z" strokeLinejoin="round" strokeLinecap="round" />
    </>
  ),
  trade: (
    <>
      <path d="M3 7l9-4 9 4-9 4-9-4z" strokeLinejoin="round" strokeLinecap="round" />
      <path d="M3 7v10l9 4 9-4V7" strokeLinejoin="round" strokeLinecap="round" />
      <path d="M12 11v10" strokeLinejoin="round" strokeLinecap="round" />
    </>
  ),
  manufacturing: (
    <>
      <path d="M4 21h16M4 21V10l5 3V10l5 3V10l5 3v8M9 17h2M14 17h2" strokeLinejoin="round" strokeLinecap="round" />
    </>
  ),
  construction: (
    <>
      <path d="M3 21h18M5 21V8l7-5 7 5v13M9 21v-6h6v6M10 11h4" strokeLinejoin="round" strokeLinecap="round" />
    </>
  ),
  hospitality: (
    <>
      <path d="M5 21V5a2 2 0 012-2h10a2 2 0 012 2v16M3 21h18M9 8h1M14 8h1M9 12h1M14 12h1M10 17h4v4h-4z" strokeLinejoin="round" strokeLinecap="round" />
    </>
  ),
  realestate: (
    <>
      <path d="M3 12l9-9 9 9M5 10v11h5v-7h4v7h5V10" strokeLinejoin="round" strokeLinecap="round" />
    </>
  ),
  logistics: (
    <>
      <path d="M3 7h11v9H3zM14 10h4l3 3v3h-7zM7.5 19a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM17.5 19a1.5 1.5 0 100-3 1.5 1.5 0 000 3z" strokeLinejoin="round" strokeLinecap="round" />
    </>
  ),
};

export default function SectorIcon({ name, className }: Props) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      className={className}
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
