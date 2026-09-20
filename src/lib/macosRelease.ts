/**
 * What the download page knows about the published macOS desktop build.
 *
 * DELIBERATELY A SEPARATE MODULE FROM `desktopRelease.ts`, which is the Windows
 * one and is not touched by this file. The two releases are published
 * independently, are signed differently, carry different install instructions,
 * and — most importantly — name their artifacts differently in ways that do not
 * generalise (see below). Folding both into one module would mean a change for
 * one platform could break the other's download link, which is the one thing on
 * this page a retailer cannot work around.
 *
 * Each platform reads its OWN manifest: Windows `latest.json`, macOS
 * `latest-macos.json`. A Tauri manifest carries one top-level `version`, so a
 * shared file would force both platforms to release in lockstep — and would
 * have told every installed Windows app that a macOS release was an update for
 * it. Separate files remove the coupling.
 *
 * ── THE ONE REAL DIFFERENCE FROM WINDOWS ────────────────────────────────────
 *
 * On Windows the updater package and the thing a person downloads are the SAME
 * FILE — Tauri signs the NSIS installer itself, and `-setup.exe` serves both a
 * first install and an update. So `desktopRelease.ts` can read
 * `platforms["windows-x86_64"].url` straight out of the manifest and hand that
 * to the download button.
 *
 * On macOS they are two different artifacts:
 *
 *   RetailCompare_<version>_aarch64.app.tar.gz   what the UPDATER fetches
 *   RetailCompare_<version>_aarch64.dmg          what a PERSON downloads
 *
 * `platforms["darwin-aarch64"].url` is the tarball. Putting that behind the
 * download button would hand a retailer a `.tar.gz` that expands to a bare
 * `.app` with no instructions and no `/Applications` shortcut — technically
 * usable, and not what anyone expects from a download page.
 *
 * So this module takes the VERSION from the manifest, exactly as the Windows
 * module does, and derives the `.dmg` filename from it. The version stays the
 * single source of truth; only the artifact selection differs.
 *
 * THAT DERIVATION IS COUPLED TO THE PUBLISH SCRIPT. `scripts/publishUpdate.mjs`
 * in the macOS project uploads the dmg under exactly this name. If one changes,
 * the other must — there is no way for this page to discover the dmg's name
 * from the manifest, because the manifest has no field for it.
 *
 * NOTHING SECRET LIVES HERE. The bucket is public and unauthenticated by
 * design — it is what the auto-updater fetches from — so the only values below
 * are ones already served to anyone who runs the app.
 */

/**
 * The public Supabase Storage bucket the installer and manifest are served
 * from. The same bucket as the Windows release, and the same env var, so the
 * two cannot be pointed at different places by accident.
 */
const RELEASE_BUCKET_URL =
  process.env.NEXT_PUBLIC_DESKTOP_RELEASE_BASE_URL ??
  "https://ijqxpoutyvgynspywgqf.supabase.co/storage/v1/object/public/desktop-updates";

/**
 * Used only when the manifest can't be read (offline build, Supabase down,
 * bucket not seeded yet). A stale value here is a fallback, not the source of
 * truth — see `getLatestMacosRelease`.
 */
const FALLBACK_VERSION = process.env.NEXT_PUBLIC_DESKTOP_MACOS_VERSION ?? "1.0.2";

/**
 * macOS builds are not signed with an Apple Developer ID yet, and the page must
 * say so rather than imply otherwise.
 *
 * A SEPARATE FLAG FROM THE WINDOWS ONE, because the two are signed by different
 * authorities on different schedules — Windows needs an Authenticode
 * certificate, macOS needs a Developer ID plus notarization, and either can
 * land first. One shared flag would mean arming one platform silently claims
 * the other is signed too, and the warning a retailer needs would vanish from
 * the page while still being true.
 */
const CODE_SIGNED = process.env.NEXT_PUBLIC_DESKTOP_MACOS_CODE_SIGNED === "true";
const BETA = process.env.NEXT_PUBLIC_DESKTOP_MACOS_BETA !== "false";

/**
 * Apple Silicon only. An Intel Mac cannot run this build at all, which is why
 * the page states the requirement rather than leaving it to be discovered.
 */
const ARCHITECTURE = "Apple Silicon (arm64)";
const TAURI_TARGET = "darwin-aarch64";
const MANIFEST_URL = `${RELEASE_BUCKET_URL}/latest-macos.json`;
const MANIFEST_FETCH_TIMEOUT_MS = 5_000;

export interface MacosRelease {
  version: string;
  /** Human platform name, as the page says it. */
  platform: string;
  architecture: string;
  /** Minimum macOS version the bundle declares. Matches tauri.conf.json. */
  minimumMacos: string;
  /** Direct link to the .dmg in the public bucket. */
  installerUrl: string;
  /** The file a browser will save. Shown so the retailer recognises it. */
  installerFilename: string;
  /** The updater manifest this release was read from (or would be). */
  manifestUrl: string;
  codeSigned: boolean;
  beta: boolean;
  /** True when the manifest actually lists a macOS build. See below. */
  published: boolean;
}

function installerFilename(version: string): string {
  return `RetailCompare_${version}_aarch64.dmg`;
}

function buildRelease(version: string, published: boolean): MacosRelease {
  const filename = installerFilename(version);
  return {
    version,
    platform: "macOS",
    architecture: ARCHITECTURE,
    minimumMacos: "12.0",
    installerFilename: filename,
    installerUrl: `${RELEASE_BUCKET_URL}/${filename}`,
    manifestUrl: MANIFEST_URL,
    codeSigned: CODE_SIGNED,
    beta: BETA,
    published,
  };
}

/** The build-time fallback release. Exported so callers have a value even without a fetch. */
export const macosRelease: MacosRelease = buildRelease(FALLBACK_VERSION, false);

/** The slice of Tauri's v2 updater manifest this page actually reads. */
interface UpdaterManifest {
  version?: string;
  platforms?: Record<string, { url?: string; signature?: string } | undefined>;
}

/**
 * The macOS version actually published right now.
 *
 * ── WHY `published` IS CHECKED SEPARATELY FROM `version` ────────────────────
 *
 * The manifest carries a top-level `version` and a `platforms` map. Before the
 * first macOS release there is no `darwin-aarch64` key at all — and if the file
 * itself is missing, the fetch simply fails. Reading a version alone would
 * render a confident macOS download button pointing at a `.dmg` that was never
 * uploaded — a 404 the retailer cannot diagnose.
 *
 * So the macOS platform entry must EXIST before this reports a published
 * release. When it does not, `published` is false and the page says the macOS
 * build is not out yet, which is the truth.
 *
 * Any failure (network, bad JSON, a manifest missing the fields we need) falls
 * back to `macosRelease` rather than throwing — a Supabase hiccup should show
 * "not published yet", not a broken page.
 */
export async function getLatestMacosRelease(): Promise<MacosRelease> {
  try {
    const response = await fetch(MANIFEST_URL, {
      signal: AbortSignal.timeout(MANIFEST_FETCH_TIMEOUT_MS),
      // Every page load reads the manifest fresh — a retailer opening this page
      // right after a release goes up must see the new version, not a cached
      // one. The short timeout above bounds the round trip.
      cache: "no-store",
    });
    if (!response.ok) return macosRelease;

    const manifest = (await response.json()) as UpdaterManifest;
    if (!manifest.version) return macosRelease;

    // The macOS entry must be present. See the note above.
    const entry = manifest.platforms?.[TAURI_TARGET];
    if (!entry?.url) return macosRelease;

    /*
     * THE VERSION IS TAKEN FROM THE TARBALL'S URL WHEN IT CAN BE, not from the
     * manifest's top-level `version`.
     *
     * Those two agree whenever both platforms are published together, and
     * disagree the moment they are not: publishing Windows 1.0.2 while macOS is
     * still on 1.0.1 leaves `version: "1.0.2"` at the top with a macOS entry
     * still pointing at the 1.0.1 tarball. Deriving the dmg name from the
     * top-level version would then link to a 1.0.2 dmg that does not exist.
     *
     * The URL names the artifact that was actually uploaded, so it is the
     * honest source. The top-level version is the fallback for a manifest
     * written before this naming existed.
     */
    const fromUrl = /RetailCompare_(\d+\.\d+\.\d+)_aarch64\.app\.tar\.gz$/.exec(entry.url)?.[1];

    return buildRelease(fromUrl ?? manifest.version, true);
  } catch {
    return macosRelease;
  }
}
