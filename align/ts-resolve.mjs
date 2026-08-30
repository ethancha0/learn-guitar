/**
 * Node ESM resolve hook so offline scripts can import the app's TypeScript
 * modules unchanged. Next.js/bundler resolution allows extensionless relative
 * imports (`./syncMap`); plain Node does not.
 *
 *   node --experimental-transform-types --import ./align/ts-resolve.mjs script.mjs
 */
import { register } from "node:module";
import { pathToFileURL } from "node:url";

if (!process.env.__TS_RESOLVE_REGISTERED) {
  process.env.__TS_RESOLVE_REGISTERED = "1";
  register("./ts-resolve-hooks.mjs", pathToFileURL(import.meta.filename));
}
