/**
 * The navigation icons, in one place.
 *
 * SHARED BY THE DESKTOP HEADER AND THE MOBILE TAB BAR, because they are the
 * same destinations. The bar is icon-only — there is no room for six words
 * along the bottom of a phone — so its glyphs ARE the labels, and a desktop
 * header drawing a different picture for the same route would teach two things
 * for one destination.
 *
 * ONE STROKE WEIGHT, ONE GRID. Icons mixed from different sets read as noise
 * rather than as a set: 24×24, 1.7 stroke, round caps and joins, and nothing
 * filled. The active state thickens the stroke rather than switching to a solid
 * variant, so the shape a person learned does not change when they arrive.
 *
 * NO ICON PACKAGE. Seven glyphs used in two files is less code than the
 * dependency, and every one of them is chosen for this app — a scan frame that
 * reads as "scan" rather than a QR block that reads as "code".
 */

export type NavIconName =
  | "home"
  | "jobs"
  | "scan"
  | "search"
  | "list"
  | "basket"
  | "user";

const PATHS: Record<NavIconName, React.ReactNode> = {
  home: (
    <>
      <path d="M3.5 11.5 12 4l8.5 7.5" />
      <path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5" />
    </>
  ),
  /** A stack of runs — a job is a file that was processed, not a to-do. */
  jobs: (
    <>
      <path d="m12 3 8.5 4.5L12 12 3.5 7.5 12 3Z" />
      <path d="m3.5 12 8.5 4.5L20.5 12" />
      <path d="m3.5 16.5 8.5 4.5 8.5-4.5" />
    </>
  ),
  /** A scan frame with a beam. A QR block would read as "code". */
  scan: (
    <>
      <path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8" />
      <path d="M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8" />
      <path d="M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16" />
      <path d="M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" />
      <path d="M4 12h16" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </>
  ),
  list: (
    <>
      <path d="M8 6h12M8 12h12M8 18h12" />
      <path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
    </>
  ),
  /** A basket, not a trolley: what a supplier calls the thing being filled. */
  basket: (
    <>
      <path d="M4 8h16l-1.4 10.2a2 2 0 0 1-2 1.8H7.4a2 2 0 0 1-2-1.8L4 8Z" />
      <path d="M8.5 8 12 3l3.5 5" />
      <path d="M10 12v4M14 12v4" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="10" r="3" />
      <path d="M6.5 18.5a6 6 0 0 1 11 0" />
    </>
  ),
};

export default function NavIcon({
  name,
  size = 16,
  active = false,
  className = "",
}: {
  name: NavIconName;
  size?: number;
  /** Thickens the stroke. The SHAPE stays the same — see the header. */
  active?: boolean;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={active ? 2.1 : 1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`shrink-0 ${className}`}
    >
      {PATHS[name]}
    </svg>
  );
}
