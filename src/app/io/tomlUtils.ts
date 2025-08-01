/**
 * tomlUtils – Foxtrot I/O helpers
 * --------------------------------
 * Pure, side‑effect‑free utilities for **reading** and **patching** the two
 * TOML configuration files that live at the root of every Foxtrot workspace:
 *
 * `project_settings.toml`
 * `part_settings.toml`
 *
 * The helpers here never interact with the VS Code configuration API or the
 * global Zustand store. Their only responsibilities are:
 *
 * 1. Locate the first workspace folder on disk.
 * 2. Read raw TOML as UTF‑8 strings.
 * 3. Apply *idempotent in‑place* edits – removing any previous entries for a
 * key before inserting the new one – so the files stay human‑readable and
 * do not accumulate duplicates over time.
 *
 * ### Public API
 *
 * | Project helpers                           | Part helpers            |
 * | ----------------------------------------- | ----------------------- |
 * | `readRawProjectSettings()`                | `readRawPartSettings()` |
 * | `readProjectSettings()`                   | —                       |
 * | `patchProjectPlugin()`                    | `patchPartActive()`     |
 * | `patchProjectFuzzer()`                    |                         |
 *
 * All functions are **resilient** – if no workspace is open or the files do
 * not exist yet, they resolve to safe defaults instead of throwing.
 * @module app/io/tomlUtils
 */

import * as path from 'path';
import * as vscode from 'vscode';

import { parse as tomlParse } from '@iarna/toml';
import fs from 'fs-extra';

/* -------------------------------------------------------------------------- */
/* Internal helpers                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Absolute path of the **first** workspace folder, or an empty string when no
 * workspace is open.
 */
const wsRoot = (): string => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';

/**
 * Read a UTF‑8 file from disk, returning an empty string when the file does not
 * exist.
 * @param {string} file Absolute path on disk.
 * @returns {Promise<string>} Contents of `file`, or `""` when missing.
 */
const readFileOr = async (file: string): Promise<string> => {
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    return '';
  }
};

/**
 * Overwrite a file with `text`, trimming any leading BOM. The existing newline
 * style (LF/CRLF) is preserved.
 * @param {string} file Absolute path on disk.
 * @param {string} text New file contents.
 * @returns {Promise<void>} Promise that resolves once the file is written.
 */
const writeFile = (file: string, text: string): Promise<void> =>
  fs.writeFile(file, text.trimStart(), 'utf8');

/* -------------------------------------------------------------------------- */
/* project_settings helpers                                                   */
/* -------------------------------------------------------------------------- */

export type ProjectSettings = {
  project?: {
    plugin?: string;
    active_fuzzer?: string;
  };
};

/** Return absolute path of `project_settings.toml`. */
const prjPath = (): string => path.join(wsRoot(), 'project_settings.toml');

/**
 * Raw TOML string of `project_settings.toml` (or `""` when missing).
 */
export const readRawProjectSettings = () => readFileOr(prjPath());

/**
 * Parsed `project_settings.toml`. Falls back to `{}` on syntax error.
 * @returns {Promise<ProjectSettings>} Parsed settings object (best‑effort).
 */
export const readProjectSettings = async (): Promise<ProjectSettings> => {
  const raw = await readRawProjectSettings();
  try {
    return tomlParse(raw) as ProjectSettings;
  } catch {
    return {};
  }
};

/**
 * Remove **all** previous occurrences of `key`—both at the root level and
 * inside any `[project]` table—then write a fresh single line with `value`.
 * @param {"plugin" | "active_fuzzer"} key The key to patch.
 * @param {string} value New value for `key`.
 * @returns {Promise<void>} Resolves once the file is updated.
 */
async function patchProjectKey(key: 'plugin' | 'active_fuzzer', value: string): Promise<void> {
  if (!wsRoot()) {
    return;
  } // Silently no‑op when no folder is open.

  const file = prjPath();
  let txt = await readFileOr(file);

  /* Regexes */
  const rootRe = new RegExp(`^[ \t]*${key}\\s*=.*$`, 'gm');
  const projRe = /^\[project\][\s\S]*?$/gm; // entire [project] block(s)
  const strip = (block: string) => block.replace(rootRe, '').trimEnd();

  /* Remove stale lines */
  txt = txt.replace(rootRe, '');
  txt = txt.replace(projRe, m => strip(m));

  const line = `${key} = "${value}"`;

  /* Insert new value */
  const firstProj = txt.match(/^\[project\]/m);
  const out = firstProj
    ? txt.replace(/^\[project\](.*?)(\r?\n)/m, `[project]$1$2${line}$2`)
    : `${txt.trimEnd()}\n\n[project]\n${line}\n`;

  await writeFile(file, out);
}

/**
 * Set the active Vivado/ISE plugin in `project_settings.toml`.
 * @param {string} name Plugin name (e.g. `"vivado‑2024"`).
 */
export const patchProjectPlugin = (name: string) => patchProjectKey('plugin', name);

/**
 * Set the currently selected fuzzer script path in `project_settings.toml`.
 * @param {string} fuzzerPath Absolute or workspace‑relative path to the fuzzer script.
 */
export const patchProjectFuzzer = (fuzzerPath: string) =>
  patchProjectKey('active_fuzzer', fuzzerPath);

/* -------------------------------------------------------------------------- */
/* part_settings helpers                                                      */
/* -------------------------------------------------------------------------- */

/** Return absolute path of `part_settings.toml`. */
const partPath = (): string => path.join(wsRoot(), 'part_settings.toml');

/** Raw TOML string of `part_settings.toml` (or `""` when missing). */
export const readRawPartSettings = () => readFileOr(partPath());

/**
 * Update (or insert) the `active_fpga` line inside `part_settings.toml`.
 * All previous occurrences—both root level and inside a `[part]` table—are
 * stripped before the new value is appended, keeping the file clean.
 * @param {string} newPath Absolute or workspace‑relative path to the selected FPGA.
 * @returns {Promise<void>} Resolves once the file is updated.
 */
export async function patchPartActive(newPath: string): Promise<void> {
  if (!wsRoot()) {
    return;
  }

  const file = partPath();
  let txt = await readFileOr(file);

  /* Remove old entries */
  txt = txt
    .replace(/^[ \t]*active_fpga\s*=.*$/gm, '')
    .replace(/^\[part\][\s\S]*?$/gm, b => b.replace(/^[ \t]*active_fpga\s*=.*$/gm, '').trimEnd());

  const line = `active_fpga = "${newPath}"`;
  const first = txt.match(/^\[part\]/m);

  const out = first
    ? txt.replace(/^\[part\](.*?)(\r?\n)/m, `[part]$1$2${line}$2`)
    : `${txt.trimEnd()}\n\n[part]\n${line}\n`;

  await writeFile(file, out);
}
