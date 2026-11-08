// Inline SVG icons, one per resource and menu entry. Line drawings in currentColor on a 24-unit
// grid, so they take the colour of the text around them. Drawn for this game; no icon library.
import type { ReactNode } from "react";

const PATHS = {
  // A stack of coins.
  cash: (
    <>
      <ellipse cx="12" cy="6" rx="7" ry="2.5" />
      <path d="M5 6v4c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6" />
      <path d="M5 10v4c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-4" />
      <path d="M5 14v4c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-4" />
    </>
  ),
  // A pair of scales.
  worth: (
    <>
      <path d="M12 3v17M7 20h10M5 6h14" />
      <path d="M5 6l-3 7h6zM19 6l-3 7h6z" />
      <path d="M2 13c0 1.7 1.3 3 3 3s3-1.3 3-3M16 13c0 1.7 1.3 3 3 3s3-1.3 3-3" />
    </>
  ),
  // A laurel wreath.
  reputation: (
    <>
      <path d="M8 20C4 17 3 12 5 6M16 20c4-3 5-8 3-14" />
      <path d="M5 9c1.5 0 2.5 1 2.5 2.5M4.5 13c1.6-.2 2.8.7 3.1 2.1M6 17c1.3-.6 2.7-.1 3.3 1.1M5 6c1.3.4 2 1.6 1.7 2.9" />
      <path d="M19 9c-1.5 0-2.5 1-2.5 2.5M19.5 13c-1.6-.2-2.8.7-3.1 2.1M18 17c-1.3-.6-2.7-.1-3.3 1.1M19 6c-1.3.4-2 1.6-1.7 2.9" />
    </>
  ),
  // A strongbox.
  deposits: (
    <>
      <rect x="3" y="8" width="18" height="12" rx="1" />
      <path d="M3 12h18M7 8V6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2" />
      <rect x="10.5" y="11" width="3" height="3" />
    </>
  ),
  // An hourglass: what the house spends each quarter.
  upkeep: (
    <>
      <path d="M6 3h12M6 21h12M7 3c0 5 10 5 10 9s-10 4-10 9M17 3c0 5-10 5-10 9s10 4 10 9" />
      <path d="M9.5 18.5h5" />
    </>
  ),
  // A barometer dial.
  market: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="1.2" />
      <path d="M12 12l4.5-4.5M6 14.5h.01M7.5 8h.01M12 5.5h.01M16.5 8h.01M18 14.5h.01" />
    </>
  ),
  // A calendar leaf.
  date: (
    <>
      <rect x="4" y="5" width="16" height="15" rx="1" />
      <path d="M4 9h16M8 3v4M16 3v4M8 13h3M8 16h6" />
    </>
  ),
  // An open account book.
  ledger: (
    <>
      <path d="M12 6c-2-1.5-5-2-9-2v15c4 0 7 .5 9 2 2-1.5 5-2 9-2V4c-4 0-7 .5-9 2z" />
      <path d="M12 6v15M5.5 8h4M5.5 11h4M5.5 14h4M14.5 8h4M14.5 11h4M14.5 14h4" />
    </>
  ),
  // The bourse: a columned hall.
  bourse: (
    <>
      <path d="M3 9l9-5 9 5zM4 20h16M3 22h18" />
      <path d="M6 10v9M10 10v9M14 10v9M18 10v9" />
    </>
  ),
  // Gabled town houses.
  houses: (
    <>
      <path d="M2 21V11l5-5 5 5v10M12 21V8l5-5 5 5v13M1 21h22" />
      <path d="M5.5 14h3M5.5 17h3M15.5 11h3M15.5 14h3M15.5 17h3" />
    </>
  ),
  // A family tree.
  family: (
    <>
      <circle cx="12" cy="4.5" r="2.5" />
      <circle cx="5" cy="19" r="2.5" />
      <circle cx="12" cy="19" r="2.5" />
      <circle cx="19" cy="19" r="2.5" />
      <path d="M12 7v9.5M12 11.5H5v5M12 11.5h7v5" />
    </>
  ),
  // A counting frame.
  counting: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="1" />
      <path d="M3 8h18M3 13h18M3 18h18" />
      <circle cx="7" cy="8" r="1.4" />
      <circle cx="10" cy="8" r="1.4" />
      <circle cx="15" cy="13" r="1.4" />
      <circle cx="8" cy="13" r="1.4" />
      <circle cx="12" cy="18" r="1.4" />
    </>
  ),
  // Merchant's scales over a sack of grain: the markets.
  markets: (
    <>
      <path d="M12 3v14M5 6h14M5 6l-3 6h6zM19 6l-3 6h6z" />
      <path d="M2 12a3 2 0 0 0 6 0M16 12a3 2 0 0 0 6 0M8 21h8M12 17v4" />
    </>
  ),
  // A sealed letter.
  letters: (
    <>
      <rect x="2" y="5" width="20" height="14" rx="1" />
      <path d="M2 6l10 7 10-7" />
      <circle cx="12" cy="14" r="2.2" />
    </>
  ),
  // The Gazette: a folded newspaper.
  gazette: (
    <>
      <path d="M4 4h13v15a2 2 0 0 0 2 2H6a2 2 0 0 1-2-2z" />
      <path d="M17 8h3v11a2 2 0 0 1-2 2M7 8h7M7 11h7M7 14h7M7 17h4" />
    </>
  ),
  // A quill: the game menu (save, load, new game).
  quill: (
    <>
      <path d="M20 3C12 4 7 9 5 19l1.5 1.5C9 13 13 9 20 3z" />
      <path d="M8 13l4 1M3 21l2-2" />
    </>
  ),
  // The Desk: an inkwell.
  desk: (
    <>
      <path d="M6 11h12l-1.5 9h-9z" />
      <path d="M9 11V8h6v3M15 5l5-3" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6L6 18" />,
  up: <path d="M12 19V5M6 11l6-6 6 6" />,
  down: <path d="M12 5v14M6 13l6 6 6-6" />,
  level: <path d="M5 12h14" />,
  warning: (
    <>
      <path d="M12 3l10 18H2z" />
      <path d="M12 10v5M12 18h.01" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

/** An icon in currentColor. Decorative unless given a label. */
export function Icon({ name, label, className = "" }: { name: IconName; label?: string; className?: string }) {
  return (
    <svg
      className={`icon ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {PATHS[name]}
    </svg>
  );
}
