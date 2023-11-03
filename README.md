# File Preview

VS Code extension that displays an arbitary file preview in a sidebar or panel 

![The docs view in the sidebar](https://raw.githubusercontent.com/permosegaard/vscode-sidebar-file-preview/master/assets/screenshot-sidebar.png)

![The docs view in the panel](https://raw.githubusercontent.com/permosegaard/vscode-sidebar-file-preview/master/assets/screenshot-panel.png)

## Features

- Watches for file changes, no manual refreshes required
- Convenient button to edit the file (creating if necessary) 
- Defaults to TODO.md, but changeable to any filename in settings
- This is designed mainly to keep TODO.md visible, but I'm happy to take pull requests for feature additions if they're ~in scope

## Configuration

- `preview.previewView.filename` — Override default filename