/**
 * BitgenProvider
 * --------------
 * Discovers EDA profiles, FPGA parts, and fuzzers for the *BitGen* phase.
 *
 * EDA discovery scans the workspace tree under:
 *   edas/<tool>/<version>/eda.toml
 *
 * Parts discovery scans:
 *   parts/<vendor>/<family>/<part>  (expects pinout.json or fabric.json present)
 *
 * Fuzzer discovery scans:
 *   fuzzers/.../script/<name>.py (prefers <dirName>.py when multiple .py files)
 *
 * This module is side-effect free and safe to import from anywhere.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';

/* -------------------------------------------------------------------------- */

export interface TreeNode {
  /** Human-friendly label to show in the UI */
  label: string;
  /** POSIX-style path relative to the workspace root */
  path: string;
  /** Child nodes (if any) */
  children?: TreeNode[];
}

/* -------------------------------------------------------------------------- */

export class BitgenProvider {
  private readonly wsRoot: string;

  constructor() {
    // Use the first workspace folder (multi-root workspaces are not yet supported here).
    this.wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
  }

  /**
   * Builds a grouped tree of *EDA tool → version* nodes from `edas/`.
   * Returns an empty array if no workspace is open.
   */
  async getEDATree(): Promise<TreeNode[]> {
    if (!this.wsRoot) {
      return [];
    }
    return buildEDATree(this.wsRoot);
  }

  /**
   * Builds the `<vendor>/<family>/<part>` hierarchy from `parts/`.
   * Returns an empty array if no workspace is open.
   */
  async getPartTree(): Promise<TreeNode[]> {
    if (!this.wsRoot) {
      return [];
    }
    return buildPartTree(this.wsRoot);
  }

  /**
   * Finds every fuzzer script underneath `fuzzers/`.
   * Returns an empty array if no workspace is open.
   */
  async getFuzzerTree(): Promise<TreeNode[]> {
    if (!this.wsRoot) {
      return [];
    }
    return buildFuzzerTree(this.wsRoot);
  }
}

/* -------------------------------------------------------------------------- */
/* EDA discovery                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Build a grouped tree of EDA tools and their versions (only versions with an `eda.toml`).
 * @param {string} wsRoot Absolute workspace root.
 */
async function buildEDATree(wsRoot: string): Promise<TreeNode[]> {
  const root = path.join(wsRoot, 'edas');
  const tools = await safeDirs(root);

  const nodes: TreeNode[] = [];
  await Promise.all(
    tools.map(async tool => {
      const toolDir = path.join(root, tool);
      const versions = await safeDirs(toolDir);

      const verNodes: TreeNode[] = [];
      await Promise.all(
        versions.map(async ver => {
          const verDir = path.join(toolDir, ver);
          const edaToml = path.join(verDir, 'eda.toml');
          try {
            await fs.access(edaToml);
            verNodes.push({ label: ver, path: toRel(wsRoot, verDir) });
          } catch {
            // missing eda.toml → skip
          }
        })
      );

      if (verNodes.length) {
        verNodes.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
        nodes.push({ label: tool, path: toRel(wsRoot, toolDir), children: verNodes });
      }
    })
  );

  return nodes.sort((a, b) => a.label.localeCompare(b.label));
}

/* -------------------------------------------------------------------------- */
/* Parts discovery                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Recursively walks `parts/` and emits `<vendor>/<family>/<part>` leaves only when
 * any of `pinout.json`, `fabric.json`, or `part.toml` exists in the part directory.
 * @param {string} wsRoot Absolute workspace root.
 */
async function buildPartTree(wsRoot: string): Promise<TreeNode[]> {
  const root = path.join(wsRoot, 'parts');
  return walk(root, 0);

  /**
   *
   */
  async function walk(dir: string, depth: number): Promise<TreeNode[]> {
    const entries = (await safeDirs(dir)).filter(isVisible);
    const nodes: TreeNode[] = [];

    await Promise.all(
      entries.map(async entry => {
        const abs = path.join(dir, entry);

        if (depth === 2) {
          if (await hasAnyFile(abs, ['pinout.json', 'fabric.json', 'part.toml'])) {
            nodes.push({ label: entry, path: toRel(wsRoot, abs) });
          }
        } else {
          const children = await walk(abs, depth + 1);
          if (children.length) {
            nodes.push({ label: entry, path: toRel(wsRoot, abs), children });
          }
        }
      })
    );

    return nodes.sort(alphaSort);
  }
}

/* -------------------------------------------------------------------------- */
/* Fuzzers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Builds a tree of fuzzer directories. Leaves point to the main Python script
 * under `script/`, preferring `<dirName>.py` if present, otherwise the first
 * `.py` file in lexical order.
 * @param {string} wsRoot Absolute workspace root.
 */
async function buildFuzzerTree(wsRoot: string): Promise<TreeNode[]> {
  const root = path.join(wsRoot, 'fuzzers');
  return walk(root);

  /**
   *
   */
  async function walk(dir: string): Promise<TreeNode[]> {
    const entries = (await safeDirs(dir)).filter(isVisible);
    const nodes: TreeNode[] = [];

    await Promise.all(
      entries.map(async entry => {
        const abs = path.join(dir, entry);
        const script = await mainScript(abs);
        if (script) {
          nodes.push({ label: entry, path: toRel(wsRoot, script) });
          return;
        }
        const children = await walk(abs);
        if (children.length) {
          nodes.push({ label: entry, path: toRel(wsRoot, abs), children });
        }
      })
    );

    return nodes.sort(alphaSort);
  }

  /**
   *
   */
  async function mainScript(dir: string): Promise<string | undefined> {
    const scriptDir = path.join(dir, 'script');
    try {
      const files = await fs.readdir(scriptDir);
      const pyFiles = files.filter(f => f.endsWith('.py'));
      if (!pyFiles.length) {
        return undefined;
      }
      const preferred = `${path.basename(dir)}.py`;
      const pick = pyFiles.includes(preferred) ? preferred : pyFiles.sort()[0];
      return path.join(scriptDir, pick);
    } catch {
      return undefined;
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Generic helpers                                                            */
/* -------------------------------------------------------------------------- */

const isVisible = (n: string): boolean => !n.startsWith('.') && n !== '__pycache__';

const alphaSort = (a: TreeNode, b: TreeNode): number =>
  a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });

/**
 * List immediate child directory names of `dir`. Returns an empty list on any error.
 */
async function safeDirs(dir: string): Promise<string[]> {
  try {
    return (await fs.readdir(dir, { withFileTypes: true }))
      .filter(d => d.isDirectory())
      .map(d => d.name);
  } catch {
    return [];
  }
}

/**
 * Test whether `name` exists inside `dir`.
 */
async function fileExists(dir: string, name: string): Promise<boolean> {
  try {
    await fs.access(path.join(dir, name));
    return true;
  } catch {
    return false;
  }
}

/**
 * True if any file in `names` exists inside `dir`.
 */
async function hasAnyFile(dir: string, names: ReadonlyArray<string>): Promise<boolean> {
  for (const n of names) {
    if (await fileExists(dir, n)) {
      return true;
    }
  }
  return false;
}

/**
 * Convert an absolute path to a POSIX-style path relative to the workspace root.
 */
function toRel(wsRoot: string, absPath: string): string {
  return path.relative(wsRoot, absPath).replace(/\\/g, '/');
}
