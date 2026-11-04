/** 지엘피핏 mark: a week of seven segments around you, today's segment lit. */
export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="glpfit-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#34d16f" />
          <stop offset="1" stopColor="#0b7a3f" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="17" fill="url(#glpfit-bg)" />
      <circle
        cx="32"
        cy="32"
        r="18"
        fill="none"
        stroke="#fff"
        strokeOpacity="0.38"
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray="6.16 10"
        transform="rotate(-84 32 32)"
      />
      <circle
        cx="32"
        cy="32"
        r="18"
        fill="none"
        stroke="#fff"
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray="6.16 106.94"
        transform="rotate(-84 32 32)"
      />
      <circle cx="32" cy="32" r="6" fill="#fff" />
    </svg>
  );
}
