/**
 * NetREC Domain
 * -------------
 * Explorer tree provider stub (not yet implemented).
 *
 * Registers the `foxtrot.netrec.explorer` Tree View in the Activity Bar.
 */

import * as vscode from 'vscode';

/**
 * Activates the NetREC domain.
 * @param {vscode.ExtensionContext} ctx VS Code extension context.
 */
export async function activate(ctx: vscode.ExtensionContext): Promise<void> {
  const provider = new NetrecExplorerProvider();

  ctx.subscriptions.push(
    vscode.window.registerTreeDataProvider('foxtrot.netrec.explorer', provider)
  );
}

/* -------------------------------------------------------------------------- */
/* Tree Provider                                                               */
/* -------------------------------------------------------------------------- */

class NetrecExplorerProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  /** Event fired when the tree needs to be refreshed. */
  readonly onDidChangeTreeData: vscode.Event<void>;

  private readonly evtEmitter = new vscode.EventEmitter<void>();

  constructor() {
    this.onDidChangeTreeData = this.evtEmitter.event;
  }

  // #region vscode.TreeDataProvider

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): vscode.ProviderResult<vscode.TreeItem[]> {
    return [
      new vscode.TreeItem(
        '⚠ NetREC explorer not implemented yet',
        vscode.TreeItemCollapsibleState.None
      ),
    ];
  }

  // #endregion
}
