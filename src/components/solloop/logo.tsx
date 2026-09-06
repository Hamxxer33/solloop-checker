export function LoopMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true" fill="none">
      <ellipse
        cx="24"
        cy="24"
        rx="16"
        ry="9"
        stroke="currentColor"
        strokeWidth="1.8"
        transform="rotate(-28 24 24)"
      />
      <ellipse
        cx="24"
        cy="24"
        rx="16"
        ry="9"
        stroke="currentColor"
        strokeWidth="1.8"
        opacity="0.55"
        transform="rotate(38 24 24)"
      />
      <circle cx="24" cy="24" r="3.2" fill="currentColor" />
    </svg>
  );
}

export function XIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}
