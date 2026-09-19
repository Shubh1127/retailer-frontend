/**
 * A file as base64, which is what the EPOS import route takes.
 *
 * CHUNKED, and that is not a micro-optimisation. Spreading a 200k-element
 * array into `String.fromCharCode` blows the JavaScript argument limit on a
 * real order file — the failure is a `RangeError` from deep inside a builtin,
 * on the one path where the user handed us their whole week's order.
 *
 * Shared by the desktop order cart and the mobile one so a fix here reaches
 * both; when each owned a copy, only one of them was ever chunked.
 */
export async function toBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
}
