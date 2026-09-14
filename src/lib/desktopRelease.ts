/**
 * What the download page knows about the published Windows desktop build.
 *
 * ONE PLACE, SO THE PAGE IS NOT THE RELEASE PROCESS. A new desktop version
 * should never mean editing JSX. The version shown is read from `latest.json`
 * in the public Supabase Storage bucket — the exact manifest the installed
 * app's own auto-updater polls — so publishing a release (dropping the new
 * installer and manifest in the bucket) is the whole release process. The
 * page picks it up on its own; nothing here needs a redeploy.
 *
 * THE URL COMES FROM THE MANIFEST, NOT FROM PASTING. `latest.json` already
 * names the installer it goes with, under `platforms["windows-x86_64"].url`.
 * Reading that instead of re-deriving a filename from the version is what
 * keeps the link from drifting apart from what got uploaded.
 *
 * NOTHING SECRET LIVES HERE. The bucket is public and unauthenticated by
 * design — it is what the auto-updater fetches from — so the only values
 * below are ones already served to anyone who runs the app.
 */

/** The public Supabase Storage bucket the installer and manifest are served from. */
const RELEASE_BUCKET_URL =
  process.env.NEXT_PUBLIC_DESKTOP_RELEASE_BASE_URL ??
  "https://ijqxpoutyvgynspywgqf.supabase.co/storage/v1/object/public/desktop-updates";

/**
 * Used only when the manifest can't be read (offline build, Supabase down,
 * bucket not seeded yet). Bump it when you remember to, but a stale value
 * here is a fallback, not the source of truth — see `getLatestWindowsRelease`.
 */
const FALLBACK_VERSION = process.env.NEXT_PUBLIC_DESKTOP_VERSION ?? "0.1.2";

/**
 * A closed beta is not code-signed yet, and the page must say so rather than
 * imply otherwise. This is a fact about the release *process*, not something
 * `latest.json` states, so it stays a flag here rather than derived from the
 * manifest. Flip it when a signed build ships.
 */
const CODE_SIGNED = process.env.NEXT_PUBLIC_DESKTOP_CODE_SIGNED === "true";
const BETA = process.env.NEXT_PUBLIC_DESKTOP_BETA !== "false";

const ARCHITECTURE = "x64";
const TAURI_TARGET = "windows-x86_64";
const MANIFEST_URL = `${RELEASE_BUCKET_URL}/latest.json`;
const MANIFEST_FETCH_TIMEOUT_MS = 5_000;

export interface DesktopRelease {
  version: string;
  /** Human platform name, as the page says it. */
  platform: string;
  architecture: string;
  /** Direct link to the installer in the public bucket. */
  installerUrl: string;
  /** The file a browser will save. Shown so the retailer recognises it. */
  installerFilename: string;
  /** The updater manifest this release was read from (or would be). */
  manifestUrl: string;
  codeSigned: boolean;
  beta: boolean;
}

function installerFilename(version: string, arch: string): string {
  return `RetailCompare_${version}_${arch}-setup.exe`;
}

function buildRelease(version: string, installerUrl?: string): DesktopRelease {
  const filename = installerFilename(version, ARCHITECTURE);
  return {
    version,
    platform: "Windows",
    architecture: ARCHITECTURE,
    installerFilename: filename,
    installerUrl: installerUrl ?? `${RELEASE_BUCKET_URL}/${filename}`,
    manifestUrl: MANIFEST_URL,
    codeSigned: CODE_SIGNED,
    beta: BETA,
  };
}

/** The build-time fallback release. Exported so callers have a value even without a fetch. */
export const windowsRelease: DesktopRelease = buildRelease(FALLBACK_VERSION);

/** The slice of Tauri's v2 updater manifest this page actually reads. */
interface UpdaterManifest {
  version?: string;
  platforms?: Record<string, { url?: string; signature?: string } | undefined>;
}

/**
 * The version actually published right now, read from the same `latest.json`
 * the installed app's auto-updater polls. This is what the download page
 * should render — it can never disagree with what the updater will offer an
 * existing install, because both read the one file.
 *
 * Any failure (network, bad JSON, a manifest missing the fields we need)
 * falls back to `windowsRelease` rather than throwing — a Supabase hiccup
 * should show a slightly stale version, not a broken page.
 */
export async function getLatestWindowsRelease(): Promise<DesktopRelease> {
  try {
    const response = await fetch(MANIFEST_URL, {
      signal: AbortSignal.timeout(MANIFEST_FETCH_TIMEOUT_MS),
      // Every page load reads the manifest fresh — a retailer opening this
      // page right after a release goes up must see the new version, not a
      // cached one. The trade-off is a Supabase round trip on every request,
      // which the short timeout above bounds.
      cache: "no-store",
    });
    if (!response.ok) return windowsRelease;

    const manifest = (await response.json()) as UpdaterManifest;
    if (!manifest.version) return windowsRelease;

    return buildRelease(manifest.version, manifest.platforms?.[TAURI_TARGET]?.url);
  } catch {
    return windowsRelease;
  }
}
