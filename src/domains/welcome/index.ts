/**
 * Welcome Domain
 * --------------
 * Entry point for the Foxtrot Welcome sidebar view.
 *
 * This module exports an `activate()` hook that registers the webview
 * provider responsible for the `foxtrot-welcome` view.
 * @see WelcomePanel
 */

import * as vscode from 'vscode';

import { WelcomePanel } from './WelcomePanel';

/* -------------------------------------------------------------------------- */
/* Activation                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Registers the Foxtrot Welcome panel in the Activity Bar.
 * @param {vscode.ExtensionContext} context - VS Code extension context supplied on activation.
 */
export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('foxtrot-welcome', new WelcomePanel(context))
  );
}
