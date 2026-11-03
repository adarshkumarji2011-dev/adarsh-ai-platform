/** Golden "A" emblem — the single ADARSH AI mark used everywhere. */
export function Emblem({ size = 40, className = '', spinning = false }) {
  return (
    <svg
      className={`emblem ${spinning ? 'emblem-spin' : ''} ${className}`}
      width={size}
      height={size}
      viewBox="0 0 128 128"
      role="img"
      aria-label="ADARSH AI golden A emblem"
    >
      <defs>
        <linearGradient id="emblemGold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#fff6d0" />
          <stop offset="34%" stopColor="#f5c453" />
          <stop offset="64%" stopColor="#c98b1e" />
          <stop offset="100%" stopColor="#ffe79a" />
        </linearGradient>
        <radialGradient id="emblemCore" cx="50%" cy="38%" r="70%">
          <stop offset="0%" stopColor="#12224a" />
          <stop offset="100%" stopColor="#05060b" />
        </radialGradient>
      </defs>
      <circle cx="64" cy="64" r="60" fill="url(#emblemCore)" />
      <circle cx="64" cy="64" r="60" fill="none" stroke="url(#emblemGold)" strokeWidth="3" />
      <circle cx="64" cy="64" r="52" fill="none" stroke="#2ea8ff" strokeOpacity="0.45" strokeWidth="1.2" />
      <circle cx="64" cy="64" r="45" fill="none" stroke="url(#emblemGold)" strokeOpacity="0.35" strokeWidth="1" strokeDasharray="3 6" />
      <path d="M64 26 L92 96 H78.5 L72.5 79 H55.5 L49.5 96 H36 Z M64 50 L59 66 H69 Z" fill="url(#emblemGold)" />
      <path d="M64 26 L92 96 H78.5 L72.5 79 H55.5 L49.5 96 H36 Z" fill="none" stroke="#fff6d0" strokeOpacity="0.6" strokeWidth="1" />
    </svg>
  );
}

export function Brand({ size = 40, showTagline = true }) {
  return (
    <span className="brand">
      <Emblem size={size} />
      <span className="brand-text">
        <span className="brand-name">
          ADARSH <span className="gold-text">AI</span>
        </span>
        {showTagline ? <span className="brand-sub">Your Smart AI Companion</span> : null}
      </span>
    </span>
  );
}
