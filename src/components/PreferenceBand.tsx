"use client";

/**
 * The signature visual: shows the main supplier's price as the anchor, a
 * shaded "preference band" (the threshold the main supplier is allowed to
 * lose by before the app diverts a line), and every other supplier's price
 * plotted on the same axis. A marker that falls to the left of the band
 * beats the threshold and wins the line.
 *
 * LABELS ARE STAGGERED, NOT JUST CENTRED UNDER THEIR MARKER.
 *
 * Prices cluster — that is the whole point of the picture, since suppliers
 * quoting within a few percent of each other is the normal case rather than
 * the exception. Two markers a couple of percent apart put their labels in
 * almost the same place, and one name is drawn over the other. With the
 * default data, Musgrave (€12.00) and O'Reillys (€11.90) land 2.4% apart on
 * the track while each label is several times wider than that gap.
 *
 * So labels are assigned to one of two rows: a label goes on the top row
 * unless something is already there within `MIN_GAP_PCT`, in which case it
 * drops to the second. Two rows are enough for realistic supplier counts and
 * keep every price readable without moving any marker away from its true
 * position — the marker is the data, the label only has to be legible.
 */

/**
 * Roughly how much horizontal room one label needs, as a percentage of the
 * track. A supplier name plus a price is about 60px wide against a track of
 * ~420px in the hero, so ~14% is the point below which two labels touch.
 */
const MIN_GAP_PCT = 20;

/**
 * Three rows is the ceiling. Beyond that the panel grows taller than the
 * picture is worth, and a fourth row is far enough from its marker that the
 * connector stops being convincing. Anything that still will not fit shares
 * row 0 and accepts a slight overlap.
 */
const MAX_ROWS = 3;

/**
 * Pixels. Kept as numbers because the container height is derived from them.
 *
 * A label is TWO lines — name over price — at 10.5px with tight leading, so it
 * stands about 26px tall. `ROW_HEIGHT` must therefore exceed `LABEL_HEIGHT`,
 * or rows overlap VERTICALLY however well they are separated horizontally,
 * and no amount of staggering helps. An earlier version had rows 22px apart
 * for 28px labels, which is precisely that mistake.
 */
const AXIS_TOP = 28;
const LABEL_TOP = 20;
const LABEL_HEIGHT = 28;
const ROW_HEIGHT = LABEL_HEIGHT + 4;

interface Offer {
  label: string;
  price: number;
  color: string;
  isMain?: boolean;
}

export default function PreferenceBand({
  mainPrice,
  thresholdPct,
  offers,
  unit = "case",
}: {
  mainPrice: number;
  thresholdPct: number;
  offers: Offer[];
  unit?: string;
}) {
  const bandFloor = mainPrice * (1 - thresholdPct);
  const all = offers.map((o) => o.price).concat([mainPrice, bandFloor]);
  const max = Math.max(...all) * 1.08;
  const min = Math.min(...all) * 0.92;
  const span = max - min || 1;
  const toPct = (v: number) => ((v - min) / span) * 100;

  const bandLeft = toPct(bandFloor);
  const bandRight = toPct(mainPrice);

  // Left to right, so "is the previous label too close" is one comparison per
  // row rather than a search over everything already placed.
  const placed = offers
    .map((offer) => ({ ...offer, pct: toPct(offer.price) }))
    .sort((a, b) => a.pct - b.pct);

  /** Right-most position used in each row so far. */
  const lastInRow: number[] = [];

  const laidOut = placed.map((offer) => {
    // The FIRST row with room, not simply "row 0 or row 1". Checking only the
    // top row and dumping everything else into the second is what let the
    // default data still collide: three of its four prices sit inside 12% of
    // the track, so the third and fourth both landed in row 1 on top of each
    // other.
    let row = lastInRow.findIndex((last) => offer.pct - last >= MIN_GAP_PCT);

    if (row === -1) {
      row = lastInRow.length < MAX_ROWS ? lastInRow.length : 0;
    }

    lastInRow[row] = offer.pct;
    return { ...offer, row };
  });

  // Only as tall as the rows actually used — a two-supplier comparison should
  // not carry the whitespace of a four-supplier one.
  const rowsUsed = Math.max(1, lastInRow.length);
  const height = AXIS_TOP + LABEL_TOP + (rowsUsed - 1) * ROW_HEIGHT + LABEL_HEIGHT;

  return (
    <div>
      {/* The axis sits near the top rather than centred, because every label
          hangs below it and the height is derived from how many rows they
          needed. */}
      <div className="relative w-full" style={{ height }}>
        {/* axis line */}
        <div
          className="absolute left-0 right-0 h-px -translate-y-1/2 bg-line"
          style={{ top: AXIS_TOP }}
        />

        {/* preference band shading */}
        <div
          className="absolute h-6 -translate-y-1/2 rounded-full bg-teal-50 ring-1 ring-inset ring-teal-500/20"
          style={{
            top: AXIS_TOP,
            left: `${bandLeft}%`,
            width: `${bandRight - bandLeft}%`,
          }}
        />
        <div
          className="absolute top-0 -translate-x-1/2 whitespace-nowrap text-[10px] font-medium text-link"
          style={{ left: `${(bandLeft + bandRight) / 2}%` }}
        >
          preference band
        </div>

        {laidOut.map((offer) => {
          const labelTop = LABEL_TOP + offer.row * ROW_HEIGHT;

          return (
            <div
              key={offer.label}
              className="absolute -translate-x-1/2 -translate-y-1/2"
              style={{ top: AXIS_TOP, left: `${offer.pct}%` }}
            >
              <div
                className={`h-3.5 w-3.5 rounded-full border-2 border-white shadow ${
                  offer.isMain ? "ring-2 ring-ink/10" : ""
                }`}
                style={{ backgroundColor: offer.color }}
                title={`${offer.label}: €${offer.price.toFixed(2)}`}
              />
              {/* A hairline from the marker down to a displaced label, so a
                  name sitting lower still reads as belonging to its own dot
                  rather than to whichever marker happens to be above it. */}
              {offer.row > 0 && (
                <div
                  className="absolute left-1/2 w-px -translate-x-1/2 bg-line"
                  style={{ top: 14, height: labelTop - 14 }}
                />
              )}
              <div
                className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-center text-[10.5px] leading-tight"
                style={{ top: labelTop }}
              >
                <div className="font-medium text-ink">{offer.label}</div>
                <div className="nums text-ink-soft">€{offer.price.toFixed(2)}</div>
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-2 text-[11.5px] text-ink-faint">
        Anything left of the band beats the main supplier by more than{" "}
        {Math.round(thresholdPct * 100)}% per {unit} — that&apos;s what wins the
        line.
      </p>
    </div>
  );
}
