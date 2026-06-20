/** The Card·O·Rama mascot: a colorful trading card with a happy face. */
export default function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
      style={{ display: "block", flexShrink: 0 }}
    >
      <defs>
        <linearGradient id="cardo-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5b8cff" />
          <stop offset="1" stopColor="#7b5cff" />
        </linearGradient>
      </defs>
      <g transform="rotate(-7 24 24)">
        <rect x="9" y="5" width="30" height="38" rx="6" fill="url(#cardo-grad)" />
        <rect x="9" y="5" width="30" height="38" rx="6" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="1.2" />
        {/* happy face */}
        <circle cx="19" cy="20" r="2.5" fill="#fff" />
        <circle cx="29" cy="20" r="2.5" fill="#fff" />
        <path d="M18 27.5 Q24 33.5 30 27.5" stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="round" />
        {/* little corner sparkle */}
        <circle cx="33.5" cy="10.5" r="1.4" fill="rgba(255,255,255,0.85)" />
      </g>
    </svg>
  );
}
