import * as vscode from 'vscode';
import { PreviewProvider } from './previewView';

export function activate(context: vscode.ExtensionContext) {
	const provider = new PreviewProvider(context.extensionUri);
	context.subscriptions.push(provider);

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(PreviewProvider.viewType, provider));

	context.subscriptions.push(
		vscode.commands.registerCommand('preview.previewView.edit', () => {
			provider.edit();
		}));
}