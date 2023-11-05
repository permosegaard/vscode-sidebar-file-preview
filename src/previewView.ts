import * as vscode from 'vscode';
import { Marked } from 'marked';
import { Highlighter, getHighlighter } from 'shiki';


const DEFAULT_FILE = "TODO.md";


enum DocumentType {
	Code,
	HTML,
	Image,
	Markdown,
	PlainText,
	Other
}


export class PreviewProvider implements vscode.WebviewViewProvider {
	private _filename?: string;
	private _view?: vscode.WebviewView;
	private _extensionUri: vscode.Uri;
	private _highlighter?: Highlighter;
	private _watcher?: vscode.FileSystemWatcher;
	private readonly _disposables: vscode.Disposable[] = [];
	public static readonly viewType = 'preview.previewView';

	constructor(extensionUri: vscode.Uri) {
		this._extensionUri = extensionUri;
		this._filename = vscode.workspace.getConfiguration("preview").get<string>("previewView.filename") || DEFAULT_FILE;

		vscode.workspace.onDidChangeConfiguration(async (event) => {
			if (event.affectsConfiguration("preview.previewView.filename")) {
				this._filename = vscode.workspace.getConfiguration("preview").get<string>("previewView.filename") || DEFAULT_FILE;
				this.reset_watcher();
			}

			if (event.affectsConfiguration("workbench.colorTheme")) {
				await this.reset_highlighter();
			}

			await this.update();
		}, null, this._disposables)
	}

	dispose() {
		this._watcher?.dispose();

		let item: vscode.Disposable | undefined;
		while ((item = this._disposables.pop())) {
			item.dispose();
		}
	}

	public async resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	) {
		this._view = webviewView;

		webviewView.webview.options = {
			enableScripts: true,
		};

		webviewView.onDidChangeVisibility(() => {
			if (this._view?.visible) {
				this.update();
			}
		});

		webviewView.onDidDispose(() => {
			this._view = undefined;
		});

		await this.update();
	}

	private async reset_highlighter() {
		const name =  vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Light ? "light-plus" : "dark-plus";
		this._highlighter = await getHighlighter({ theme: name });
	}

	private reset_watcher() {
		if (this._watcher !== undefined) { this._watcher.dispose(); }

		let timeout: NodeJS.Timeout; // NOTE: debounce
		const update = async () => {
			if (timeout) { clearTimeout(timeout); }
			timeout = setTimeout(async () => { await this.update(); }, 100);
		}

		const watcher = vscode.workspace.createFileSystemWatcher(`**/${this._filename}`);
		watcher.onDidChange(update);
		watcher.onDidCreate(update);
		watcher.onDidDelete(update);

		this._watcher = watcher;
	}

	public async edit() {
		let document;

		if (vscode.workspace.workspaceFolders === undefined) {
			vscode.window.showErrorMessage("workspace not opened");
			return;
		}

		let folder = await this.get_folder();

		if (folder === false) {
			const folder = vscode.workspace.workspaceFolders[0];
			const path = vscode.Uri.joinPath(folder.uri, this._filename as string);
			await vscode.workspace.fs.writeFile(path, Uint8Array.from([]));

			document = await vscode.workspace.openTextDocument(path);
		}
		else {
			const path = vscode.Uri.joinPath((folder as vscode.WorkspaceFolder).uri, this._filename as string);
			document = await vscode.workspace.openTextDocument(path);
		}

		await vscode.window.showTextDocument(document);
	}


	private async update() {
		if (!this._view) {
			return;
		}

		if (!this._watcher) { this.reset_watcher(); }
		if (!this._highlighter) { await this.reset_highlighter(); }

		this._view.title = "VIEWER";
		this._view.description = `${this._filename}`;

		const updatePromise = async () => {
			let html: string;

			if (vscode.workspace.workspaceFolders === undefined) {
				html = default_html(this._view!, this._extensionUri, "<body><span style='font-style: italic'>&nbsp; &nbsp; No folder or workspace loaded</span></body>");
			}
			else {
				let workspace_folder = await this.get_folder();

				if (!workspace_folder) {
					html = default_html(this._view!, this._extensionUri, "<body><span style='font-style: italic'>&nbsp; &nbsp; File not found</span></body>");
				}
				else {
					switch (filename_to_document_type(this._filename!)) {
						case DocumentType.Image:
							html = render_image(
								this._view!, this._extensionUri, workspace_folder as vscode.WorkspaceFolder, this._filename!
							);
							break;
						case DocumentType.Code:
							html = await render_code(
								this._view!, this._extensionUri, workspace_folder as vscode.WorkspaceFolder, this._highlighter!, this._filename!
							);
							break;
						case DocumentType.Markdown:
							html = await render_markdown(
								this._view!, this._extensionUri, workspace_folder as vscode.WorkspaceFolder, this._highlighter!, this._filename!);
							break;
						case DocumentType.HTML:
							html = await render_html(workspace_folder as vscode.WorkspaceFolder, this._filename!);
							break;
						case DocumentType.PlainText:
							html = await render_plaintext(
								this._view!, this._extensionUri, workspace_folder as vscode.WorkspaceFolder, this._filename!
							);
							break;
						case DocumentType.Other:
							vscode.window.showErrorMessage("not implemented for filetype");
							break;
					}
				}
			}

			// console.log(html); // NOTE: testing here!
			this._view!.webview.html = html!;
		};

		// Don't show progress indicator right away, which causes a flash
		await new Promise<void>(resolve => setTimeout(resolve, 50)).then(() => {
			return vscode.window.withProgress({ location: { viewId: PreviewProvider.viewType } }, updatePromise);
		});
	}

	private async get_folder(): Promise<vscode.WorkspaceFolder | false> {
		for (const folder of vscode.workspace.workspaceFolders!) {
			try {
				const path = vscode.Uri.joinPath(folder.uri, this._filename as string);
				await vscode.workspace.fs.readFile(path);
				return folder;
			}
			catch (exception) { /* no-op */ }
		}

		return false;
	}
}


function getNonce(): string {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}

function filename_to_document_type(filename: string): DocumentType {
	const extension_mappings = [ // NOTE: feel free to open pull's with additions
		[DocumentType.Markdown, ["md"]],
		[DocumentType.PlainText, ["txt", "text", "csv"]],
		[DocumentType.HTML, ["htm", "html"]],
		[DocumentType.Image, ["bmp", "jpg", "jpeg", "png", "gif"]],
		[DocumentType.Code, [
			"js", "jsx", "ts", "tsx", // javascripts
			"lua", // lua
			"rs", // rust
			"sh", "ps1" // shell
		]],
	];

	for (const [kind, extensions] of extension_mappings) {
		for (const extension of (extensions as string[])) {
			if (filename.endsWith(`.${extension}`)) {
				return kind as DocumentType;
			}
		}
	}

	return DocumentType.Other;
}

function fix_workspace_path(view: vscode.WebviewView, workspace_folder: vscode.WorkspaceFolder, filename: string): vscode.Uri {
	const path = vscode.Uri.joinPath((workspace_folder as vscode.WorkspaceFolder).uri, filename);
	return view?.webview.asWebviewUri(path);
}

function default_html(webview: vscode.WebviewView, extension_folder: vscode.Uri, body: string) {
	const styleUri = webview.webview.asWebviewUri(vscode.Uri.joinPath(extension_folder, 'media', 'main.css'));

	const nonce = getNonce();

	return `
		<!DOCTYPE html>
		<html lang="en">
			<head>
				<meta charset="UTF-8">

				<meta http-equiv="Content-Security-Policy" content="
					default-src 'none';
					style-src ${webview.webview.cspSource} 'unsafe-inline';
					script-src 'nonce-${nonce}';
					img-src data: https:;
					">

				<meta name="viewport" content="width=device-width, initial-scale=1.0">

				<link href="${styleUri}" rel="stylesheet">
				
				<title>Preview</title>
			</head>
			${body}
		</html>
	`;
}

function render_image(view: vscode.WebviewView, extension_folder: vscode.Uri, workspace_folder: vscode.WorkspaceFolder, filename: string) {
	const fixed_path = fix_workspace_path(view, workspace_folder, filename);

	return default_html(view, extension_folder, `<body><img src="${fixed_path}" style="objecft-fit: contain;"/></body>`);
}

async function render_plaintext(view: vscode.WebviewView, extension_folder: vscode.Uri, workspace_folder: vscode.WorkspaceFolder, filename: string) {
	const path = vscode.Uri.joinPath((workspace_folder as vscode.WorkspaceFolder).uri, filename);
	const contents = await vscode.workspace.fs.readFile(path);

	return default_html(view, extension_folder, `<body><p>${contents}</p></body>`);
}

async function render_html(workspace_folder: vscode.WorkspaceFolder, filename: string) {
	// NOTE: we could try rewriting local relative assets, like we do for markdown, but it'll rabbit-hole quickly...
	// NOTE: https://github.com/vscode-restructuredtext/vscode-restructuredtext/blob/6f048a34dfba987fb777accb6de73c12e8a1ae4d/src/preview/rstEngine.ts#L171

	const path = vscode.Uri.joinPath(workspace_folder.uri, filename);
	const contents = await vscode.workspace.fs.readFile(path);

	return contents.toString();
}

async function render_markdown(view: vscode.WebviewView, extension_folder: vscode.Uri, workspace_folder: vscode.WorkspaceFolder, highlighter: Highlighter, filename: string) {
	const path = vscode.Uri.joinPath((workspace_folder as vscode.WorkspaceFolder).uri, filename);
	const contents = await vscode.workspace.fs.readFile(path);

	const renderer = {
		code(code: string, infostring: string | undefined, _escaped: boolean): string | false {
			const infos = infostring?.trim().split(" ");

			if (infos !== undefined && infos.length < 1) {
				return code;
			}
			else {
				const html = highlighter.codeToHtml(code, { lang: infos![0] });
				return `<div style='margin: 0 5px 0 5px;'>${html}</div>`;
			}
		},
		image(href: string, title: string | null, _text: string): string | false {
			for (const scheme of ["://", "http://", "https://"]) {
				if (href.startsWith(scheme)) {
					return `<img alt="${title || ""}" src="${href}"/>`;
				}
			}

			const path = vscode.Uri.joinPath((workspace_folder as vscode.WorkspaceFolder).uri, href);
			const fixed_path = view?.webview.asWebviewUri(path);
			return `<img alt="${title || ""}" src="${fixed_path}"/>`;
		}
	};

	const marked = new Marked({ renderer: renderer, gfm: true, async: true, silent: true });

	const parsed = await marked.parse(contents.toString());
	return default_html(view, extension_folder, `<body>${parsed}</body>`);
}

async function render_code(view: vscode.WebviewView, extension_folder: vscode.Uri, workspace_folder: vscode.WorkspaceFolder, highlighter: Highlighter, filename: string) {
	const path = vscode.Uri.joinPath((workspace_folder as vscode.WorkspaceFolder).uri, filename);
	const document = await vscode.workspace.openTextDocument(path);

	const marked = new Marked({
		renderer: {
			code(code: string, _infostring: string | undefined, _escaped: boolean): string | false {
				const html = highlighter.codeToHtml(code, { lang: document.languageId });
				return `<div style='margin: 0 5px 0 5px;'>${html}</div>`;
			},
		},
		async: true,
		silent: true,
	});

	const parsed = await marked.parse(`\`\`\`${document.languageId}\n${document.getText()}\n\`\`\``);
	return default_html(view, extension_folder, `<body>${parsed}</body>`);
}