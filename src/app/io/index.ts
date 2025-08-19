/**
 * Foxtrot I/O barrel
 * ------------------
 * Exposes all side‑effect‑free helpers that live under `src/app/io`.
 * Keeping a dedicated barrel lets us grow the folder without changing
 * import sites.
 * @example
 * ```ts
 * import { patchProjectPlugin } from "@/app/io";
 * ```
 * @module app/io
 */

export * from './tomlUtils';
