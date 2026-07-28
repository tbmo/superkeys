# superkeys

vscode extension. write your keybindings and file "views" as javascript instead of hand-editing `keybindings.json` and clicking around.

two things it does:

- **keybindings as code** — drop a `*.keys.cjs` file in `.vscode/superkeys/` and it gets compiled down into vscode's `keybindings.json`. you write rules, not raw json blobs.
- **views** — a `*.views.cjs` file describes a set of files by glob. run it and it dumps/aggregates their contents into one file or your clipboard. good for grabbing a chunk of a repo to paste somewhere.

## install

not on the marketplace, build it yourself:

```
npm install
./scripts/linux-install.sh      # linux / mac
./scripts/install-superkeys.ps1 # windows
```

both just `vsce package` and install the vsix. needs vsce (`npm i -g vsce`).

## use

run these from the command palette:

- `Superkeys: Create Default Configs` — drops starter `.keys.cjs` / `.views.cjs` into `.vscode/superkeys/`
- `Superkeys: Create Type Definitions` — writes `.d.ts` files so you get autocomplete while editing configs
- `Superkeys: Load Configs` — recompile after you change something
- `Superkeys: Run View` / `Open View In Workspace` — run a view

## settings

| setting | what it does |
|---|---|
| `superkeys.live` | write compiled keybindings to the real `keybindings.json` |
| `superkeys.dryrun` | write to a test file in `.vscode` instead of the real one |
| `superkeys.useClipboard` | view dumps go to the clipboard instead of a file |
| `superkeys.viewOutputFilename` | filename for view dumps (default `__dump.txt`) |
| `superkeys.showPrivateViews` | show private views in the palette (debugging) |

see `superkeys_default/` for example configs.
