/**
 * Foxtrot global **store**
 * ----------------------
 * Zustand-based application state that tracks user selections for the two
 * primary domains:
 *
 * • **Bit-Gen** – plugin / fuzzer / FPGA part
 * • **Bit-Map** – database / run / bitstream / Jupyter notebook
 *
 * Every mutation is immediately persisted to the VS Code workspace-level
 * settings **and** to the project TOML configuration files so the CLI and other
 * tooling stay in sync with the extension.
 * @example
 * ```ts
 * import { useFoxtrotStore, initState } from "@/app";
 *
 * // inside a React component
 * const activePlugin = useFoxtrotStore(state => state.activePlugin);
 * ```
 * @module app/state
 */

import * as vscode from 'vscode';

import { createStore } from 'zustand/vanilla';

import {
  readRawProjectSettings,
  patchProjectPlugin,
  patchProjectFuzzer,
  readRawPartSettings,
  patchPartActive,
} from '../io/tomlUtils';

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

interface FoxtrotSlice {
  /* Bit-Gen selections */
  activePlugin: string | null;
  activeFuzzer: string | null;
  activePart: string | null;

  /* Bit-Map selections */
  activeBitmapDb: string | null;
  activeBitmapRun: string | null;
  activeBitmapBitstream: string | null;
  activeBitmapNotebook: string | null;

  /* Setters – Bit-Gen */
  setActivePlugin(id: string | null): void;
  setActiveFuzzer(id: string | null): void;
  setActivePart(id: string | null): void;

  /* Setters – Bit-Map */
  setActiveBitmapDb(v: string | null): void;
  setActiveBitmapRun(v: string | null): void;
  setActiveBitmapBitstream(v: string | null): void;
  setActiveBitmapNotebook(v: string | null): void;
}

export type FoxtrotState = FoxtrotSlice;

/* -------------------------------------------------------------------------- */
/* Store creation                                                             */
/* -------------------------------------------------------------------------- */

const store = createStore<FoxtrotState>(() => ({
  /* Bit-Gen defaults */
  activePlugin: null,
  activeFuzzer: null,
  activePart: null,

  /* Bit-Map defaults */
  activeBitmapDb: null,
  activeBitmapRun: null,
  activeBitmapBitstream: null,
  activeBitmapNotebook: null,

  /* ───── setters – Bit-Gen */
  setActivePlugin: id => update({ activePlugin: id }),
  setActiveFuzzer: id => update({ activeFuzzer: id }),
  setActivePart: id => update({ activePart: id }),

  /* ───── setters – Bit-Map */
  setActiveBitmapDb: v =>
    update({
      activeBitmapDb: v,
      activeBitmapRun: null,
      activeBitmapBitstream: null,
    }),
  setActiveBitmapRun: v =>
    update({
      activeBitmapRun: v,
      activeBitmapBitstream: null,
    }),
  setActiveBitmapBitstream: v => update({ activeBitmapBitstream: v }),
  setActiveBitmapNotebook: v => update({ activeBitmapNotebook: v }),
}));

/* -------------------------------------------------------------------------- */
/* Persistence helpers                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Update VS Code workspace configuration but ignore keys that are not yet
 * declared in package.json (occurs during dev cycles).
 */
async function safeUpdate(
  key: string,
  val: unknown,
  cfg: vscode.WorkspaceConfiguration
): Promise<void> {
  if (!vscode.workspace.workspaceFolders?.length) {
    return;
  }

  try {
    await cfg.update(key, val, vscode.ConfigurationTarget.Workspace);
  } catch (e: unknown) {
    const err = e as { code?: string };
    if (err.code !== 'configurationNotRegistered') {
      throw e;
    }
  }
}

/**
 * Core reducer: merge the partial slice, persist it, then mirror the change to
 * the TOML files so external tooling stays aligned.
 */
async function update(partial: Partial<FoxtrotState>): Promise<void> {
  store.setState(partial);

  const cfg = vscode.workspace.getConfiguration();

  /* Bit-Gen */
  if (Object.prototype.hasOwnProperty.call(partial, 'activePlugin')) {
    await safeUpdate('foxtrot.activePlugin', partial.activePlugin, cfg);
    if (partial.activePlugin) {
      await patchProjectPlugin(partial.activePlugin).catch(err =>
        console.warn('[Foxtrot] patch plugin:', (err as Error).message)
      );
    }
  }

  if (Object.prototype.hasOwnProperty.call(partial, 'activeFuzzer')) {
    await safeUpdate('foxtrot.activeFuzzer', partial.activeFuzzer, cfg);
    if (partial.activeFuzzer) {
      await patchProjectFuzzer(partial.activeFuzzer).catch(err =>
        console.warn('[Foxtrot] patch fuzzer:', (err as Error).message)
      );
    }
  }

  if (Object.prototype.hasOwnProperty.call(partial, 'activePart')) {
    await safeUpdate('foxtrot.activePart', partial.activePart, cfg);
    if (partial.activePart) {
      await patchPartActive(partial.activePart).catch(err =>
        console.warn('[Foxtrot] patch part:', (err as Error).message)
      );
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Initialisation / reload helpers                                            */
/* -------------------------------------------------------------------------- */

/**
 * One-shot initialisation during `activate()`.
 */
export async function initState(_: vscode.ExtensionContext): Promise<void> {
  const cfg = vscode.workspace.getConfiguration();
  const { plugin, fuzzer, part } = await selectionsFromToml();

  await update({
    activePlugin: plugin ?? cfg.get<string>('foxtrot.activePlugin') ?? null,
    activeFuzzer: fuzzer ?? cfg.get<string>('foxtrot.activeFuzzer') ?? null,
    activePart: part ?? cfg.get<string>('foxtrot.activePart') ?? null,
  });
}

/**
 * Reread the TOMLs after a bootstrap command to ensure UI reflects filesystem
 * state.
 */
export async function reloadPersistedState(): Promise<void> {
  const cfg = vscode.workspace.getConfiguration();
  const { plugin, fuzzer, part } = await selectionsFromToml();

  await update({
    activePlugin: plugin ?? cfg.get<string>('foxtrot.activePlugin') ?? null,
    activeFuzzer: fuzzer ?? cfg.get<string>('foxtrot.activeFuzzer') ?? null,
    activePart: part ?? cfg.get<string>('foxtrot.activePart') ?? null,
  });
}

/* -------------------------------------------------------------------------- */
/* Selectors                                                                  */
/* -------------------------------------------------------------------------- */

/** Zustand vanilla store accessor – returns the underlying store instance. */
export const useFoxtrotStore = () => store;

/* -------------------------------------------------------------------------- */
/* Internals                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Parse current selections from the TOML files so we can bootstrap the in-mem
 * store.
 */
async function selectionsFromToml(): Promise<{
  plugin: string | null;
  fuzzer: string | null;
  part: string | null;
}> {
  const rawPrj = await readRawProjectSettings();
  const rawPart = await readRawPartSettings();

  const plugin =
    rawPrj.match(/^\[project\][\s\S]*?plugin\s*=\s*"(.*?)"/m)?.[1] ??
    rawPrj.match(/^plugin\s*=\s*"(.*?)"/m)?.[1] ??
    null;

  const fuzzer =
    rawPrj.match(/^\[project\][\s\S]*?active_fuzzer\s*=\s*"(.*?)"/m)?.[1] ??
    rawPrj.match(/^active_fuzzer\s*=\s*"(.*?)"/m)?.[1] ??
    null;

  const part =
    rawPart.match(/^\[part\][\s\S]*?active_fpga\s*=\s*"(.*?)"/m)?.[1] ??
    rawPart.match(/^active_fpga\s*=\s*"(.*?)"/m)?.[1] ??
    null;

  return { plugin, fuzzer, part };
}
