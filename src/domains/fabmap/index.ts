/* -------------------------------------------------------------------------- */
/* FabMAP Explorer Domain                                                      */
/* -------------------------------------------------------------------------- */
/**
 * Registers an empty **FabMAP** explorer view. Acts as a placeholder until the
 * domain is fully implemented.
 *
 * Conventions applied:
 *  • Pure, side‑effect‑free construction of the provider.
 *  • Clear file header & JSDoc describing intent and usage.
 *  • Export only the public `activate` entry point; no implicit globals.
 *  • Strict typing for all VS Code API interactions.
 */

import * as vscode from 'vscode';

/** Activate the FabMAP domain. */
export function activate(ctx: vscode.ExtensionContext): void {
  const provider = new FabmapExplorerProvider();

  ctx.subscriptions.push(
    vscode.window.registerTreeDataProvider('foxtrot.fabmap.explorer', provider)
  );
}

/* -------------------------------------------------------------------------- */
/* Private helpers                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Basic `TreeDataProvider` that shows a single stub item. Replace with a real
 * implementation once FabMAP functionality is available.
 */
class FabmapExplorerProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly changeEmitter = new vscode.EventEmitter<
    void | vscode.TreeItem | vscode.TreeItem[] | null | undefined
  >();

  /** Fires whenever the tree needs to be refreshed. */
  readonly onDidChangeTreeData = this.changeEmitter.event;

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): vscode.ProviderResult<vscode.TreeItem[]> {
    return [
      new vscode.TreeItem(
        '⚠ FabMAP explorer not implemented yet',
        vscode.TreeItemCollapsibleState.None
      ),
    ];
  }

  /** Manually trigger a tree refresh. */
  refresh(): void {
    this.changeEmitter.fire();
  }
}
