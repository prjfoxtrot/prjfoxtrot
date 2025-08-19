/**
 * Foxtrot global **store**
 * ----------------------
 * Zustand-based application state that tracks user selections for the two
 * primary domains:
 *
 * • **BitGen** – plugin / fuzzer / FPGA part
 * • **BitMap** – database / run / bitstream / Jupyter notebook
 *
 * Every mutation is immediately persisted to the VS Code workspace-level
 * settings **and** to the project TOML configuration files so the CLI and other
 * tooling stay in sync with the extension.
 * @example
 * ```ts
 * import { useFoxtrotStore, initState } from "@/app";
 *
 * // inside a React component
 * const activeEDA = useFoxtrotStore(state => state.activeEDA);
 * ```
 * @module app/state
 */

import * as vscode from 'vscode';

import { createStore } from 'zustand/vanilla';

import { readRawProjectSettings, patchProjectKey } from '../io/tomlUtils';

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

interface FoxtrotSlice {
  /* BitGen selections */
  activeEDA: string | null;
  activeFuzzer: string | null;
  activePart: string | null;

  /* BitMap selections */
  activeBitmapDb: string | null;
  activeBitmapRun: string | null;
  activeBitmapBitstream: string | null;
  activeBitmapNotebook: string | null;

  /* Setters – BitGen */
  setActiveEDA(id: string | null): void;
  setActiveFuzzer(id: string | null): void;
  setActivePart(id: string | null): void;

  /* Setters – BitMap */
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
  activeEDA: null,
  activeFuzzer: null,
  activePart: null,

  activeBitmapDb: null,
  activeBitmapRun: null,
  activeBitmapBitstream: null,
  activeBitmapNotebook: null,

  setActiveEDA: id => update({ activeEDA: id }),
  setActiveFuzzer: id => update({ activeFuzzer: id }),
  setActivePart: id => update({ activePart: id }),

  setActiveBitmapDb: v =>
    update({ activeBitmapDb: v, activeBitmapRun: null, activeBitmapBitstream: null }),
  setActiveBitmapRun: v => update({ activeBitmapRun: v, activeBitmapBitstream: null }),
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

  if (Object.prototype.hasOwnProperty.call(partial, 'activeEDA')) {
    await safeUpdate('foxtrot.activeEDA', partial.activeEDA, cfg);
    if (partial.activeEDA) {
      await patchProjectKey('active_eda', partial.activeEDA).catch(err =>
        console.warn('[Foxtrot] patch active_eda:', (err as Error).message)
      );
    }
  }

  if (Object.prototype.hasOwnProperty.call(partial, 'activeFuzzer')) {
    await safeUpdate('foxtrot.activeFuzzer', partial.activeFuzzer, cfg);
    if (partial.activeFuzzer) {
      await patchProjectKey('active_fuzzer', partial.activeFuzzer).catch(err =>
        console.warn('[Foxtrot] patch active_fuzzer:', (err as Error).message)
      );
    }
  }

  if (Object.prototype.hasOwnProperty.call(partial, 'activePart')) {
    await safeUpdate('foxtrot.activePart', partial.activePart, cfg);
    if (partial.activePart) {
      await patchProjectKey('active_part', partial.activePart).catch(err =>
        console.warn('[Foxtrot] patch active_part:', (err as Error).message)
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
  const { eda, fuzzer, part } = await selectionsFromToml();

  await update({
    activeEDA: eda ?? cfg.get<string>('foxtrot.activeEDA') ?? null,
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
  const { eda, fuzzer, part } = await selectionsFromToml();

  await update({
    activeEDA: eda ?? cfg.get<string>('foxtrot.activeEDA') ?? null,
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
  eda: string | null;
  fuzzer: string | null;
  part: string | null;
}> {
  const rawPrj = await readRawProjectSettings();

  const eda =
    rawPrj.match(/^\[project\][\s\S]*?active_eda\s*=\s*"(.*?)"/m)?.[1] ??
    rawPrj.match(/^active_eda\s*=\s*"(.*?)"/m)?.[1] ??
    null;

  const fuzzer =
    rawPrj.match(/^\[project\][\s\S]*?active_fuzzer\s*=\s*"(.*?)"/m)?.[1] ??
    rawPrj.match(/^active_fuzzer\s*=\s*"(.*?)"/m)?.[1] ??
    null;

  const part =
    rawPrj.match(/^\[project\][\s\S]*?active_part\s*=\s*"(.*?)"/m)?.[1] ??
    rawPrj.match(/^active_part\s*=\s*"(.*?)"/m)?.[1] ??
    null;

  return { eda, fuzzer, part };
}
