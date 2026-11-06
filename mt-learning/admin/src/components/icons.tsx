const PATHS = {
  home: <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  people: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2 20c1-3.5 3.6-5 7-5s6 1.5 7 5" />
      <circle cx="17" cy="7" r="2.5" />
      <path d="M17 13c2.4 0 4.2 1.3 5 4" />
    </>
  ),
  cal: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  layers: (
    <>
      <path d="M12 3l9 5-9 5-9-5z" />
      <path d="M3 13l9 5 9-5" />
    </>
  ),
  hostel: (
    <>
      <path d="M3 21V9l9-6 9 6v12" />
      <path d="M9 21v-6h6v6M3 21h18" />
    </>
  ),
  book: (
    <>
      <path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z" />
      <path d="M4 19V5M9 7h6" />
    </>
  ),
  test: (
    <>
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M9 8h6M9 12h6M9 16h3" />
    </>
  ),
  chart: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  bell: (
    <>
      <path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4z" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </>
  ),
  live: (
    <>
      <rect x="2" y="6" width="14" height="12" rx="2" />
      <path d="M16 10l6-3v10l-6-3" />
    </>
  ),
  tablet: (
    <>
      <rect x="5" y="2" width="14" height="20" rx="2" />
      <path d="M11 18h2" />
    </>
  ),
  shield: <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />,
  key: (
    <>
      <circle cx="8" cy="15" r="4" />
      <path d="M11 12l9-9M17 6l3 3" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  file: (
    <>
      <path d="M6 2h9l5 5v15H6z" />
      <path d="M14 2v6h6" />
    </>
  ),
  play: <path d="M7 4l13 8-13 8z" />,
  link: (
    <>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    </>
  ),
  trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />,
  up: <path d="M12 19V5M6 11l6-6 6 6" />,
  down: <path d="M12 5v14M6 13l6 6 6-6" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  check: <path d="M5 12l5 5 9-10" />,
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}

/** College crest: a navy shield with a gold border, an open book and a tablet. */
export function Crest({ size = 48 }: { size?: number }) {
  return (
    <svg viewBox="0 0 48 56" width={size * (48 / 56)} height={size} aria-hidden="true">
      <path d="M24 2 L45 9 V27 C45 41 35 50 24 54 C13 50 3 41 3 27 V9 Z" fill="#0d2a4c" stroke="#c9a24a" strokeWidth="2.5" />
      <path d="M24 7 L40.5 12.5 V27 C40.5 38 33 45.5 24 49 C15 45.5 7.5 38 7.5 27 V12.5 Z" fill="none" stroke="#c9a24a" strokeWidth="0.9" opacity="0.7" />
      <path d="M12 21 C16 19 20 19 24 21.5 C28 19 32 19 36 21 V34 C32 32 28 32 24 34.5 C20 32 16 32 12 34 Z" fill="#f6f1e4" />
      <path d="M24 21.5 V34.5" stroke="#0d2a4c" strokeWidth="1.2" />
      <rect x="20.5" y="37" width="7" height="9" rx="1.2" fill="none" stroke="#c9a24a" strokeWidth="1.4" />
      <circle cx="24" cy="43.6" r="0.9" fill="#c9a24a" />
      <path d="M16 15.5 L24 12.5 L32 15.5" fill="none" stroke="#c9a24a" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function Logo({ size = 36 }: { size?: number }) {
  return <Crest size={size} />;
}

/** Colour per subject code, shared with the tablet app. */
const SUBJECT_COLORS: Record<string, string> = {
  PHY: 'var(--c1)',
  CHE: 'var(--c2)',
  MAT: 'var(--c3)',
  BIO: 'var(--c4)',
  ENG: 'var(--c5)',
  KAN: 'var(--c6)',
};
const FALLBACK = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)'];

export function subjectColor(code: string | undefined | null): string {
  if (!code) return 'var(--board)';
  if (SUBJECT_COLORS[code]) return SUBJECT_COLORS[code];
  let h = 0;
  for (const ch of code) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return FALLBACK[h % FALLBACK.length];
}

export function SubjectChip({ code, name }: { code?: string | null; name?: string | null }) {
  return (
    <span className="subject-chip" style={{ ['--c' as string]: subjectColor(code) }}>
      {name ?? code}
    </span>
  );
}
