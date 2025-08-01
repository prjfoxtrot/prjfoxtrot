/**
 * Scaffolds a BitMap analysis folder and opens a starter Jupyter notebook.
 *
 * Directory layout: <workspace>/bitmap/<device>/<slug>/<ISO-timestamp>/
 * @example
 *   await createBitmapAnalysis(context);
 *
 * Implementation notes:
 * - Requires that the user has first selected a database *and* bitstream in the Bit‑Map sidebar.
 * - Uses `vscode.workspaceState` to persist last‑used form values.
 * - Selects a notebook template based on the chosen clustering algorithm; falls
 *   back to `template_default.ipynb` or a blank notebook if none is found.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';

import { useFoxtrotStore } from '../app/state';

/** Persisted BitMap form values. */
interface AnalysisFormState {
  /** Clustering algorithm (e.g. "DBSCAN", "HDBSCAN") */
  algo: string;
  /** Algorithm‑specific parameters or sweeps keyed by name */
  params: Record<string, string | number>;
  /** User‑added feature masks (absolute paths) */
  masks: string[];
}

const FORM_STATE_KEY = 'bitmap.formState';
const NOTEBOOK_NAME = 'analysis.ipynb';

/**
 * Command entry point registered as `foxtrot.bitmap.newAnalysis`.
 */
export async function createBitmapAnalysis(context: vscode.ExtensionContext): Promise<void> {
  try {
    validatePrerequisites();

    const workspaceRoot = getWorkspaceRoot();
    const formState = getFormState(context);
    const destination = await createDestinationFolder(workspaceRoot, formState);
    await writeAnalysisConfig(destination, formState);
    await copyNotebookTemplate(context, formState.algo, destination);

    // Open the newly created notebook in Jupyter
    await vscode.commands.executeCommand(
      'vscode.openWith',
      vscode.Uri.file(path.join(destination, NOTEBOOK_NAME)),
      'jupyter.notebook.ipynb'
    );

    vscode.window.showInformationMessage('BitMap analysis folder created.');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`Create analysis failed: ${message}`);
  }
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 *
 */
function validatePrerequisites(): void {
  const { activeBitmapDb, activeBitmapBitstream } = useFoxtrotStore().getState();

  if (!activeBitmapDb || !activeBitmapBitstream) {
    throw new Error('Select both database and bitstream first (Bit‑Map side‑bar).');
  }

  if (!vscode.workspace.workspaceFolders?.length) {
    throw new Error('No workspace open.');
  }
}

/**
 *
 */
function getWorkspaceRoot(): string {
  return vscode.workspace.workspaceFolders![0].uri.fsPath;
}

/**
 *
 */
function getFormState(ctx: vscode.ExtensionContext): AnalysisFormState {
  return (
    ctx.workspaceState.get<AnalysisFormState>(FORM_STATE_KEY) ?? {
      algo: 'DBSCAN',
      params: {},
      masks: [],
    }
  );
}

/**
 *
 */
async function createDestinationFolder(
  workspaceRoot: string,
  form: AnalysisFormState
): Promise<string> {
  const { activePart } = useFoxtrotStore().getState();
  const device = activePart ? path.basename(activePart) : 'generic';

  const frameLen = (form.params as Record<string, unknown>)?.frame_size ?? 'unk';
  const slug = `${form.algo.toLowerCase()}_L${frameLen}`;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  const dest = path.join(workspaceRoot, 'bitmap', device, slug, timestamp);
  await fs.mkdir(dest, { recursive: true });
  return dest;
}

/**
 *
 */
async function writeAnalysisConfig(dest: string, form: AnalysisFormState): Promise<void> {
  const st = useFoxtrotStore().getState();

  const cfg = {
    db: st.activeBitmapDb,
    run: st.activeBitmapRun,
    bitstream: st.activeBitmapBitstream,
    ...form,
  };

  await fs.writeFile(path.join(dest, 'analysis-cfg.json'), JSON.stringify(cfg, null, 2), 'utf8');
}

/**
 *
 */
async function copyNotebookTemplate(
  ctx: vscode.ExtensionContext,
  algo: string,
  dest: string
): Promise<void> {
  const baseDir = path.join(ctx.extensionPath, 'resources', 'notebooks', 'bitmap');
  const candidate = path.join(baseDir, `template_${algo.toLowerCase()}.ipynb`);
  const fallback = path.join(baseDir, 'template_default.ipynb');
  const output = path.join(dest, NOTEBOOK_NAME);

  const src = (await pathExists(candidate))
    ? candidate
    : (await pathExists(fallback))
      ? fallback
      : null;

  if (src) {
    await fs.copyFile(src, output);
  } else {
    // Safety net – create a blank notebook
    const blankNotebook = { cells: [], metadata: {}, nbformat: 4, nbformat_minor: 5 } as const;
    await fs.writeFile(output, JSON.stringify(blankNotebook, null, 2), 'utf8');
  }
}

/**
 *
 */
async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
