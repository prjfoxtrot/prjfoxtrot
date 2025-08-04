/**
 * Foxtrot *app* barrel module
 * ---------------------------
 * Central export surface for the runtime layer that lives under `src/app`.
 * Consumers should **not** import deep paths like `../app/state/index`; instead rely on
 * this façade to keep future refactors internal to `app/`.
 * @example
 * ```ts
 * import { useFoxtrotStore, initState } from "@/app";
 * import { patchPartActive } from "@/app/io";
 * ```
 * @module app
 */

export { useFoxtrotStore, initState } from './state';
export * as io from './io';
