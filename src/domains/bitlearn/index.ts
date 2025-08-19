import * as vscode from 'vscode';

/*───────────────────────────────────────────────────────────────*\
  BitLearn domain – stub explorer (not yet implemented)
\*───────────────────────────────────────────────────────────────*/
/**
 *
 */
export async function activate(ctx: vscode.ExtensionContext) {
  const provider = new (class implements vscode.TreeDataProvider<vscode.TreeItem> {
    readonly onDidChangeTreeData = new vscode.EventEmitter<void>().event;
    getTreeItem(i: vscode.TreeItem) {
      return i;
    }
    getChildren() {
      return [new vscode.TreeItem('⚠ Not implemented yet', vscode.TreeItemCollapsibleState.None)];
    }
  })();

  ctx.subscriptions.push(
    vscode.window.registerTreeDataProvider('foxtrot.bitlearn.explorer', provider)
  );
}
