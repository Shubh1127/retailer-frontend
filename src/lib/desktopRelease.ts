/**
 * What the download page knows about the published Windows desktop build.
 *
 * ONE PLACE, SO THE PAGE IS NOT THE RELEASE PROCESS. A new desktop version
 * should never mean editing JSX. Today the facts are constants here; when the
 * release pipeline starts publishing them — the updater already writes
 * `latest.json` beside the installer in the same public bucket — this module
 * becomes the thing that reads them, and the page does not change at all.
 * Everything it exports is therefore *data about a release*, never markup.
 *
 * THE URL IS BUILT, NOT PASTED. The installer's name follows the bundler's
 * convention (`RetailCompare_<version>_<arch>-setup.exe`), so deriving it from
 * the version is what keeps the two from drifting apart in a hand-edit.
 *
 * NOTHING SECRET LIVES HERE. The bucket is public and unauthenticated by
 * design — it is what the auto-updater fetches from — so the only values below
 * are ones already served to anyone who runs the app.
 */

/** The public Supabase Storage bucket the installer and manifest are served from. */
const RELEASE_BUCKET_URL =
  process.env.NEXT_PUBLIC_DESKTOP_RELEASE_BASE_URL ??
  "https://ijqxpoutyvgynspywgqf.supabase.co/storage/v1/object/public/desktop-updates";

/** The currently published desktop version. Matches the Tauri bundle's own. */
const CURRENT_VERSION = process.env.NEXT_PUBLIC_DESKTOP_VERSION ?? "0.1.2";

export interface DesktopRelease {
  version: string;
  /** Human platform name, as the page says it. */
  platform: string;
  architecture: string;
  /** Direct link to the installer in the public bucket. */
  installerUrl: string;
  /** The file a browser will save. Shown so the retailer recognises it. */
  installerFilename: string;
  /**
   * The updater manifest the installed app polls. Not linked from the page —
   * it is here because "where the release lives" is one fact, and splitting it
   * across two files is how the two get out of step.
   */
  manifestUrl: string;
  /**
   * A closed beta is not code-signed yet, and the page must say so rather than
   * imply otherwise. A signed build flips this flag; nothing else changes.
   */
  codeSigned: boolean;
  beta: boolean;
}

function installerFilename(version: string, arch: string): string {
  return `RetailCompare_${version}_${arch}-setup.exe`;
}

const ARCHITECTURE = "x64";

export const windowsRelease: DesktopRelease = {
  version: CURRENT_VERSION,
  platform: "Windows",
  architecture: ARCHITECTURE,
  installerFilename: installerFilename(CURRENT_VERSION, ARCHITECTURE),
  installerUrl: `${RELEASE_BUCKET_URL}/${installerFilename(CURRENT_VERSION, ARCHITECTURE)}`,
  manifestUrl: `${RELEASE_BUCKET_URL}/latest.json`,
  codeSigned: false,
  beta: true,
};
