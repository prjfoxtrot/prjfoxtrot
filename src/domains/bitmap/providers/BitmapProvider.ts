/**
 * BitmapProvider
 * --------------
 * VS Code **TreeDataProvider** powering the “BitMap” explorer view.
 *
 * 1. Surfaces `*.db` files inside **bitstreams/** ➜ distinct `run_id`s ➜ bitstream rows.
 * 2. Provides helper getters consumed by the `BitmapPanel` webview.
 * 3. Executes queries through native **better‑sqlite3** when available (preferred),
 *    transparently falling back to **sql.js** (wasm) otherwise.
 *
 * Activation event: `onView:foxtrot.bitmap.explorer`
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';

/* -------------------------------------------------------------------------- */
/*                              SQLite load helpers                           */
/* -------------------------------------------------------------------------- */

/** Minimal runtime shape for the *better‑sqlite3* constructor we use. */
interface BetterSqlite {
  new (
    filename: string,
    options: { readonly: boolean; fileMustExist: boolean }
  ): {
    prepare<T = unknown>(sql: string): { all(...params: unknown[]): T[] };
    close(): void;
  };
}

let betterSqlite: BetterSqlite | null | undefined;

/**
 * Lazily loads **better‑sqlite3** via dynamic `import()`.
 * Returns *null* when the native binding isn’t present so callers can fall back
 * to the wasm path.
 */
async function loadBetterSqlite(): Promise<BetterSqlite | null> {
  if (betterSqlite !== undefined) {
    return betterSqlite;
  }

  try {
    // eslint-disable-next-line import/no-unresolved
    // @ts-expect-error – optional native dependency without typings
    // eslint-disable-next-line import/no-unresolved
    const mod: unknown = await import('better-sqlite3');
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    betterSqlite = mod as BetterSqlite;
  } catch {
    betterSqlite = null;
  }

  return betterSqlite;
}

/* -------------------------------------------------------------------------- */
/*                                tiny query helper                           */
/* -------------------------------------------------------------------------- */

/**
 * Executes an SQL statement against the given database **read‑only**.
 * @template T
 * @param {string}      dbPath  Absolute path to the `*.db` file.
 * @param {string}      sql     Parameterised SQL string.
 * @param {unknown[]}  [params] Positional parameters (optional).
 * @returns {Promise<T[]>} Result rows.
 */
export async function query<T = unknown>(
  dbPath: string,
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  // Prefer the native binding when present.
  const Native = await loadBetterSqlite();
  if (Native) {
    const db = new Native(dbPath, { readonly: true, fileMustExist: true });
    const rows = db.prepare<T>(sql).all(...params);
    db.close();
    return rows;
  }

  // wasm fallback (sql.js ships no typings)
  // @ts-expect-error – sql.js lacks TypeScript declarations.
  const init = (await import('sql.js')).default;
  const SQL = await init();
  const file = await fs.readFile(dbPath);
  const db = new SQL.Database(new Uint8Array(file));
  const res = db.exec(sql, params);
  if (!res.length) {
    return [];
  }

  const { columns, values } = res[0];
  return values.map((row: unknown[]) =>
    Object.fromEntries(columns.map((c: string, i: number) => [c, row[i]]))
  ) as T[];
}

/* -------------------------------------------------------------------------- */
/*                                 tree node types                            */
/* -------------------------------------------------------------------------- */

export interface TreeNode {
  label: string;
  path: string;
  type: 'db' | 'run' | 'bitstream' | 'notebook' | 'hint';
  meta?: { db?: string; run?: string; bs?: string };
}

/* -------------------------------------------------------------------------- */
/*                                   provider                                 */
/* -------------------------------------------------------------------------- */

export class BitmapProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';

  private readonly _ev = new vscode.EventEmitter<TreeNode | undefined>();
  readonly onDidChangeTreeData = this._ev.event;
  refresh(): void {
    this._ev.fire(undefined);
  }

  constructor(private readonly extPath: string) {}

  /* ------------------------------ helper getters -------------------------- */
  /** Returns top‑level DB nodes for the webview. */
  getDbTree() {
    return this.dbTree();
  }
  getRunTree(db: string) {
    return this.runTree(db);
  }
  getBitstreamTree(meta: { db: string; run: string }) {
    return this.bitstreamTree(meta);
  }
  getNotebookTree() {
    return this.notebookTree();
  }

  /* ------------------------- TreeDataProvider API ------------------------- */
  getTreeItem(node: TreeNode): vscode.TreeItem {
    const collapsible =
      node.type === 'notebook' || node.type === 'hint'
        ? vscode.TreeItemCollapsibleState.None
        : vscode.TreeItemCollapsibleState.Collapsed;

    const item = new vscode.TreeItem(node.label, collapsible);
    item.id = node.path;
    item.contextValue = node.type;

    if (node.type === 'hint') {
      item.tooltip = 'Nothing found';
    }

    if (node.type === 'notebook') {
      item.resourceUri = vscode.Uri.file(node.path);
      item.command = {
        command: 'vscode.openWith',
        title: 'Open notebook',
        arguments: [item.resourceUri, 'jupyter.notebook.ipynb'],
      } as vscode.Command;
    }

    return item;
  }

  async getChildren(node?: TreeNode): Promise<TreeNode[]> {
    if (!this.wsRoot) {
      return [];
    }

    if (!node) {
      return this.dbTree();
    }
    if (node.type === 'db') {
      return this.runTree(node.path);
    }
    if (node.type === 'run' && node.meta?.db && node.meta?.run) {
      return this.bitstreamTree({ db: node.meta.db, run: node.meta.run });
    }
    if (node.type === 'bitstream') {
      return this.notebookTree();
    }

    return [];
  }

  /* ---------------------------------------------------------------------- */
  /*                               tier builders                            */
  /* ---------------------------------------------------------------------- */

  private async dbTree(): Promise<TreeNode[]> {
    const hits = await vscode.workspace.findFiles('**/bitstreams/**/*.{db,sqlite}');
    return hits.length
      ? hits
          .map(u => ({
            label: path.basename(u.fsPath),
            path: u.fsPath,
            type: 'db' as const,
          }))
          .sort(alpha)
      : [hint('(no .db files under bitstreams/)')];
  }

  private async runTree(dbPath: string): Promise<TreeNode[]> {
    try {
      const rows = await query<{ run_id: number }>(
        dbPath,
        'SELECT DISTINCT run_id FROM runs ORDER BY run_id'
      );

      return rows.length
        ? rows.map(r => ({
            label: `run ${r.run_id}`,
            path: `${dbPath}::${r.run_id}`,
            type: 'run' as const,
            meta: { db: dbPath, run: String(r.run_id) },
          }))
        : [hint('(no rows in runs table)')];
    } catch (err: unknown) {
      return [hint(`(error: ${(err as Error).message})`)];
    }
  }

  private async bitstreamTree(meta: { db: string; run: string }): Promise<TreeNode[]> {
    try {
      const rows = await query<{ id: number; filename?: string }>(
        meta.db,
        'SELECT id, filename FROM bitstreams WHERE run_id = ? ORDER BY id',
        [meta.run]
      );

      return rows.length
        ? rows.map(r => ({
            label: r.filename ?? `bitstream ${r.id}`,
            path: `${meta.db}::${meta.run}::${r.id}`,
            type: 'bitstream' as const,
            meta: { ...meta, bs: String(r.id) },
          }))
        : [hint('(no bitstreams for this run)')];
    } catch (err: unknown) {
      return [hint(`(error: ${(err as Error).message})`)];
    }
  }

  private async notebookTree(): Promise<TreeNode[]> {
    const wsHits = await vscode.workspace.findFiles('**/notebooks/bitmap/**/*.ipynb');
    const extHits = await vscode.workspace.findFiles(
      new vscode.RelativePattern(
        path.join(this.extPath, 'resources/notebooks/bitmap'),
        '**/*.ipynb'
      )
    );

    const toNode = (u: vscode.Uri): TreeNode => ({
      label: path.basename(u.fsPath),
      path: u.fsPath,
      type: 'notebook',
    });

    const nodes = [...wsHits.map(toNode), ...extHits.map(toNode)].sort(alpha);
    return nodes.length ? nodes : [hint('(no notebooks found)')];
  }
}

/* -------------------------------------------------------------------------- */
/*                                    utils                                   */
/* -------------------------------------------------------------------------- */

/** Case‑insensitive alpha sort for labels. */
const alpha = ((a: TreeNode, b: TreeNode) =>
  a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })) satisfies (
  a: TreeNode,
  b: TreeNode
) => number;

/** Shorthand helper for creating single‑line hint nodes. */
const hint = (label: string): TreeNode => ({ label, path: '_', type: 'hint' });
