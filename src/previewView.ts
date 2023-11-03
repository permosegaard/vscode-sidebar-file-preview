import * as vscode from 'vscode';
import { CodeHighlighter } from './codeHighlighter';
import { marked } from 'marked';


const DEFAULT_FILE = "TODO.md";


export class PreviewProvider implements vscode.WebviewViewProvider {
	private _filename?: string;
	private _view?: vscode.WebviewView;
	private _watcher?: vscode.FileSystemWatcher;
	private readonly _disposables: vscode.Disposable[] = [];
	public static readonly viewType = 'preview.previewView';

	constructor(
		private readonly _extensionUri: vscode.Uri,
	) {
		this.updateConfiguration();
		// this.update();
		this.reset_watcher();

		vscode.workspace.onDidChangeConfiguration(() => {
			this.updateConfiguration();
			this.update();
			this.reset_watcher();
		}, null, this._disposables)
	}

	dispose() {
		this._watcher?.dispose();

		let item: vscode.Disposable | undefined;
		while ((item = this._disposables.pop())) {
			item.dispose();
		}
	}

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	) {
		this._view = webviewView;

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [
				vscode.Uri.joinPath(this._extensionUri, 'media')
			]
		};

		webviewView.onDidChangeVisibility(() => {
			if (this._view?.visible) {
				this.update();
			}
		});

		webviewView.onDidDispose(() => {
			this._view = undefined;
		});

		webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

		this.update();
		// this.reset_watcher();
	}

	private reset_watcher() {
		if (this._watcher !== undefined) { this._watcher.dispose(); }

		const watcher = vscode.workspace.createFileSystemWatcher(`**/${this._filename}`);
		watcher.onDidChange(() => this.update());
		watcher.onDidCreate(() => this.update());
		watcher.onDidDelete(() => this.update());

		this._watcher = watcher;
	}

	public async edit() {
		let document = await this.get_document();
		if (document === undefined) {
			if (vscode.workspace.workspaceFolders === undefined) {
				console.log("workspace not opened");
				return;
			}
			else {
				const folder = vscode.workspace.workspaceFolders[0];

				const todo_path = vscode.Uri.joinPath(folder.uri, this._filename as string);
				await vscode.workspace.fs.writeFile(todo_path, Uint8Array.from([]));

				document = await vscode.workspace.openTextDocument(todo_path);
			}
		}

		await vscode.window.showTextDocument(document);
	}

	private _getHtmlForWebview(webview: vscode.Webview) {
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.js'));
		const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.css'));

		const nonce = getNonce();

		return /* html */`<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">

				<meta http-equiv="Content-Security-Policy" content="
					default-src 'none';
					style-src ${webview.cspSource} 'unsafe-inline';
					script-src 'nonce-${nonce}';
					img-src data: https:;
					">

				<meta name="viewport" content="width=device-width, initial-scale=1.0">

				<link href="${styleUri}" rel="stylesheet">
				
				<title>Documentation View</title>
			</head>
			<body>
				<article id="main"></article>

				<script nonce="${nonce}" src="${scriptUri}"></script>
			</body>
			</html>`;
	}

	private async update() {
		if (!this._view) {
			return;
		}

		this._view.title = "VIEWER";
		this._view.description = `${this._filename}`;

		const updatePromise = (async () => {
			let body;

			let document = await this.get_document();
			if (document === undefined) {
				body = "<span style='font-style: italic'>&nbsp; &nbsp; File not found</span>"
			}
			else {
				body = marked(document.getText(), {
					highlight: await (new CodeHighlighter()).getHighlighter(document),
					sanitize: true
				});
			}

			this._view?.webview.postMessage({ body, type: 'update' });
		})();

		// Don't show progress indicator right away, which causes a flash
		await new Promise<void>(resolve => setTimeout(resolve, 50)).then(() => {
			return vscode.window.withProgress({ location: { viewId: PreviewProvider.viewType } }, () => updatePromise);
		});
	}

	private updateConfiguration() {
		const config = vscode.workspace.getConfiguration('preview');
		this._filename = config.get<string>('previewView.filename') || DEFAULT_FILE;
	}

	private async get_document(): Promise<vscode.TextDocument | undefined> {
		if (vscode.workspace.workspaceFolders !== undefined) {
			for (const folder of vscode.workspace.workspaceFolders) {
				try {
					const todo_path = vscode.Uri.joinPath(folder.uri, this._filename as string);
					return await vscode.workspace.openTextDocument(todo_path);
				}
				catch (exception) { /* no-op */ }
			}
		}
	}
}


function getNonce() {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}