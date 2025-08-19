import * as path from 'path';
import * as vscode from 'vscode';

import { parse as tomlParse, stringify as tomlStringify, JsonMap } from '@iarna/toml';
import fs from 'fs-extra';

/* -------------------------------------------------------------------------- */

const wsRoot = (): string => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';

const readFileOr = async (file: string): Promise<string> => {
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    return '';
  }
};

const writeFile = (file: string, text: string): Promise<void> =>
  fs.writeFile(file, text.replace(/^\uFEFF/, ''), 'utf8');

/* -------------------------------------------------------------------------- */
/* project_settings helpers                                                   */
/* -------------------------------------------------------------------------- */

// Model the TOML as JSON the way @iarna/toml expects.
type ProjectSection = JsonMap & {
  active_eda?: string;
  active_part?: string;
  active_fuzzer?: string;
  db_path?: string;
};

export type ProjectSettings = JsonMap & {
  project?: ProjectSection;
};

const prjPath = (): string => path.join(wsRoot(), 'project_settings.toml');

export const readRawProjectSettings = () => readFileOr(prjPath());

export const readProjectSettings = async (): Promise<ProjectSettings> => {
  const raw = await readRawProjectSettings();
  try {
    // parse() returns a JsonMap; narrow to our shape
    return tomlParse(raw) as ProjectSettings;
  } catch {
    return {} as ProjectSettings;
  }
};

/**
 * Idempotently set a single key inside [project] and re-serialize with @iarna/toml
 * to avoid stray blank lines.
 */
export async function patchProjectKey(
  key: 'active_eda' | 'active_part' | 'active_fuzzer',
  value: string
): Promise<void> {
  if (!wsRoot()) {
    return;
  }

  const file = prjPath();
  const parsed = await readProjectSettings();

  const project: ProjectSection = { ...(parsed.project ?? {}) };
  project[key] = value;

  const next: ProjectSettings = { ...parsed, project };
  const text = tomlStringify(next); // next is a JsonMap by type
  await writeFile(file, text.endsWith('\n') ? text : text + '\n');
}
