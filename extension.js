const vscode = require("vscode");
const micromatch = require("micromatch");
const path = require("path");
const fs = require("fs");
const {
  a,
  buildAll,
  clearSkipShellCommands,
  setWorkspaceRoot,
} = require("./src/rule.cjs");

const { v, VIEWS, getPublicViews } = require("./src/view.cjs");

let configWatcher;
let outputChannel;
let defaultKeybindings = [];
let isApplying = false;
let initialized = false;

const userDataPath =
  process.env.APPDATA ||
  (process.platform === "darwin"
    ? process.env.HOME + "/Library/Application Support"
    : process.env.HOME + "/.config");

function getKeybindingsPath() {
  return path.join(userDataPath, "Code", "User", "keybindings.json");
}

const superkeysConfigDir = path.join(
  vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath || "",
  ".vscode",
  "superkeys",
);

const keybindingsFilePattern = "*.keys.cjs";
const keybindingsPattern = new vscode.RelativePattern(
  vscode.workspace.workspaceFolders[0],
  `.vscode/superkeys/${keybindingsFilePattern}`,
);

const viewFilePattern = "*.views.cjs";
const viewPattern = new vscode.RelativePattern(
  vscode.workspace.workspaceFolders[0],
  `.vscode/superkeys/${viewFilePattern}`,
);

const allPattern = vscode.workspace.workspaceFolders?.[0]
  ? new vscode.RelativePattern(
      vscode.workspace.workspaceFolders[0],
      `.vscode/superkeys/*.cjs`,
    )
  : null;

function getKeybindingsConfigPaths() {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!folder) return [];

  if (!fs.existsSync(superkeysConfigDir)) {
    fs.mkdirSync(superkeysConfigDir, { recursive: true });
  }

  try {
    const files = fs.readdirSync(superkeysConfigDir);
    return files
      .filter((file) => micromatch.isMatch(file, keybindingsFilePattern))
      .map((file) => path.join(superkeysConfigDir, file))
      .sort();
  } catch (error) {
    return [];
  }
}

function getViewConfigPaths() {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!folder) return [];

  if (!fs.existsSync(superkeysConfigDir)) {
    fs.mkdirSync(superkeysConfigDir, { recursive: true });
  }

  try {
    const files = fs.readdirSync(superkeysConfigDir);
    return files
      .filter((file) => micromatch.isMatch(file, viewFilePattern))
      .map((file) => path.join(superkeysConfigDir, file))
      .sort();
  } catch (error) {
    return [];
  }
}

const cachedDefaultsPath = path.join(
  vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath || "",
  ".vscode",
  "cache",
  "default-keybindings.json",
);

const isLiveMode = () =>
  vscode.workspace.getConfiguration("superkeys").get("live", false);

const isDryRunMode = () =>
  vscode.workspace.getConfiguration("superkeys").get("dryrun", false);

const isUseClipboard = () =>
  vscode.workspace.getConfiguration("superkeys").get("useClipboard", true);

const isEnabledAny = () => isLiveMode() || isDryRunMode();

function initialize(context) {
  if (initialized) {
    return;
  }
  initialized = true;
  outputChannel = vscode.window.createOutputChannel("Superkeys");
  context.subscriptions.push(outputChannel);

  setWorkspaceRoot(vscode.workspace.workspaceFolders[0].uri.fsPath);
}

async function updateSkipShellSettings() {
  const { getSkipShellCommands } = require("./src/rule.cjs");
  const skipCommands = getSkipShellCommands();

  if (skipCommands.length === 0) {
    return;
  }

  const config = vscode.workspace.getConfiguration();
  const currentSkipCommands = config.get(
    "terminal.integrated.commandsToSkipShell",
    [],
  );

  const mergedCommands = [
    ...new Set([...currentSkipCommands, ...skipCommands]),
  ];

  mergedCommands.sort();

  const hasChanges =
    mergedCommands.length !== currentSkipCommands.length ||
    !mergedCommands.every((cmd, i) => cmd === currentSkipCommands[i]);

  if (hasChanges) {
    await config.update(
      "terminal.integrated.commandsToSkipShell",
      mergedCommands,
      vscode.ConfigurationTarget.Workspace,
    );
  }
}

async function activate(context) {
  initialize(context);

  registerCommands(context);
  await checkKeybindingsCached(outputChannel);

  applyViewConfigs();
  watchConfigs(context);

  const enabledAny = isLiveMode() || isDryRunMode();
  if (enabledAny) {
    const configPaths = getKeybindingsConfigPaths();

    const hasConfigs = configPaths.length > 0;

    if (hasConfigs) {
      await applyKeybindingsConfig();
    }
  }
}

function registerCommands(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand("superkeys.loadConfigs", async () => {
      await applyKeybindingsConfig();
      await applyViewConfigs();
    }),

    vscode.commands.registerCommand("superkeys.runView", async () => {
      const views = getPublicViews();
      const names = Object.keys(views);

      if (names.length === 0) {
        vscode.window.showErrorMessage("No views available.");
        return;
      }

      let selected;
      if (names.length === 1) {
        selected = names[0];
      } else {
        selected = await vscode.window.showQuickPick(names, {
          placeHolder: "Choose a view to run",
        });
      }

      if (selected) {
        const view = views[selected];
        await writeOutView(selected);
      }
    }),

    vscode.commands.registerCommand(
      "superkeys.createDefaultConfigs",
      async () => {
        await createDefaultKeybindings();
        await createDefaultViews();
        copyTypeDefinitions();
      },
    ),

    vscode.commands.registerCommand("superkeys.openView", async () => {
      const views = getPublicViews();
      const names = Object.keys(views);

      if (names.length === 0) {
        vscode.window.showErrorMessage("No views available.");
        return;
      }

      let selected;
      if (names.length === 1) {
        selected = names[0];
      } else {
        selected = await vscode.window.showQuickPick(names, {
          placeHolder: "Choose a view to run",
        });
      }

      if (selected) {
        await openViewInWorkspace(selected);
      }
    }),
  );
}

function copyTypeDefinitions() {
  const defaultDir = path.join(__dirname, "superkeys_default");
  const sourceTypesDir = path.join(defaultDir, ".types");
  const destTypesDir = path.join(superkeysConfigDir, ".types");

  // Create .types subfolder if it doesn't exist
  if (!fs.existsSync(destTypesDir)) {
    fs.mkdirSync(destTypesDir, { recursive: true });
  }

  const typeFiles = ["view.d.ts", "rule.d.ts"];

  // Copy type definition files from .types subfolder
  for (const file of typeFiles) {
    const sourcePath = path.join(sourceTypesDir, file);
    const destPath = path.join(destTypesDir, file);

    if (fs.existsSync(sourcePath)) {
      fs.copyFileSync(sourcePath, destPath);
    }
  }

  // Copy jsconfig.json to main superkeys folder (needs to be at root level)
  const jsconfigSource = path.join(defaultDir, "jsconfig.json");
  const jsconfigDest = path.join(superkeysConfigDir, "jsconfig.json");
  if (fs.existsSync(jsconfigSource)) {
    fs.copyFileSync(jsconfigSource, jsconfigDest);
  }
}

async function createDefaultKeybindings() {
  const configPaths = getKeybindingsConfigPaths();
  if (configPaths.length > 0) {
    vscode.window.showInformationMessage(
      "Keybindings config files already exist.",
    );
    return;
  }

  const defaultConfigPath = path.join(
    __dirname,
    "superkeys_default",
    "base.keys.cjs",
  );

  const destPath = path.join(superkeysConfigDir, "base.keys.cjs");

  fs.copyFileSync(defaultConfigPath, destPath);

  vscode.window.showInformationMessage(
    `Default keybindings config created at ${destPath}`,
  );
}

async function createDefaultViews() {
  const configPaths = getViewConfigPaths();
  if (configPaths.length > 0) {
    vscode.window.showInformationMessage("View config files already exist.");
    return;
  }

  const defaultConfigPath = path.join(
    __dirname,
    "superkeys_default",
    "base.views.cjs",
  );

  const destPath = path.join(superkeysConfigDir, "base.views.cjs");

  fs.copyFileSync(defaultConfigPath, destPath);

  vscode.window.showInformationMessage(
    `Default views config created at ${destPath}`,
  );
}

async function checkKeybindingsCached(outputChannel) {
  try {
    if (!vscode.workspace.workspaceFolders?.[0]) {
      defaultKeybindings = [];
      return;
    }

    const cacheDir = path.dirname(cachedDefaultsPath);
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    if (fs.existsSync(cachedDefaultsPath)) {
      try {
        const content = fs.readFileSync(cachedDefaultsPath, "utf8");
        defaultKeybindings = JSON.parse(content);
        return;
      } catch (e) {}
    }

    await vscode.commands.executeCommand(
      "workbench.action.openDefaultKeybindingsFile",
    );

    await new Promise((resolve) => setTimeout(resolve, 1000));

    const editor = vscode.window.activeTextEditor;
    if (editor && editor.document.fileName.includes("keybindings.json")) {
      let content = editor.document.getText();

      const startIndex = content.indexOf("[");
      const endIndex = content.lastIndexOf("]");
      if (startIndex !== -1 && endIndex !== -1) {
        content = content.substring(startIndex, endIndex + 1);
      } else {
        return;
      }

      defaultKeybindings = JSON.parse(content);

      fs.writeFileSync(
        cachedDefaultsPath,
        JSON.stringify(defaultKeybindings, null, 2),
      );

      await vscode.commands.executeCommand(
        "workbench.action.closeActiveEditor",
      );
    } else {
      defaultKeybindings = [];
    }
  } catch (e) {
    defaultKeybindings = [];
  }
}

function applyViewConfigs() {
  const configPaths = getViewConfigPaths();

  if (configPaths.length === 0) {
    return;
  }

  try {
    Object.keys(VIEWS).forEach((key) => delete VIEWS[key]);

    global.v = v;

    for (const configPath of configPaths) {
      try {
        if (require.cache[require.resolve(configPath)]) {
          delete require.cache[require.resolve(configPath)];
        }

        const vm = require("vm");
        const code = fs.readFileSync(configPath, "utf8");

        const sandbox = {
          v,
          console,
          __dirname: path.dirname(configPath),
          __filename: configPath,
          module: { exports: {} },
          exports: {},
        };

        vm.createContext(sandbox);
        vm.runInContext(code, sandbox);
      } catch (err) {}
    }
  } catch (e) {
    vscode.window.showErrorMessage("Error loading views.");
  } finally {
    delete global.v;
  }
}

function watchConfigs(context) {
  if (configWatcher) {
    try {
      configWatcher.dispose();
    } catch {}
    configWatcher = null;
  }
  if (!vscode.workspace.workspaceFolders?.[0] || !allPattern) return;

  const w = vscode.workspace.createFileSystemWatcher(allPattern);

  async function handle(uri, kind) {
    const file = path.basename(uri.fsPath);

    if (file.endsWith(".keys.cjs")) {
      if (isEnabledAny() && !isApplying) {
        await applyKeybindingsConfig();
        vscode.window.showInformationMessage(
          `Superkeys keybindings config ${kind}.`,
        );
      }
    } else if (file.endsWith(".views.cjs")) {
      applyViewConfigs();
      vscode.window.showInformationMessage(`Superkeys view config ${kind}.`);
    }
  }

  w.onDidChange((uri) => handle(uri, "changed"));
  w.onDidCreate((uri) => handle(uri, "created"));
  w.onDidDelete((uri) => handle(uri, "deleted"));

  configWatcher = {
    dispose() {
      try {
        w.dispose();
      } catch {}
    },
  };

  context.subscriptions.push({
    dispose: () => configWatcher && configWatcher.dispose(),
  });
}

async function applyKeybindingsConfig() {
  if (isApplying) {
    return;
  }

  const configPaths = getKeybindingsConfigPaths();

  if (configPaths.length === 0) {
    vscode.window.showErrorMessage("No keybindings config files found.");
    return;
  }

  if (!isEnabledAny()) {
    return;
  }

  isApplying = true;

  try {
    const dryRunPath = path.join(
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || "",
      ".vscode",
      "cache",
      "dry.keybindings.json",
    );

    if (isDryRunMode()) {
    }

    clearSkipShellCommands();
    global.a = a;

    for (const configPath of configPaths) {
      try {
        if (require.cache[require.resolve(configPath)]) {
          delete require.cache[require.resolve(configPath)];
        }

        const vm = require("vm");
        const code = fs.readFileSync(configPath, "utf8");

        const sandbox = {
          a,
          console,
          __dirname: path.dirname(configPath),
          __filename: configPath,
          module: { exports: {} },
          exports: {},
        };

        vm.createContext(sandbox);
        vm.runInContext(code, sandbox);
      } catch (err) {}
    }

    const defs = Array.isArray(defaultKeybindings) ? defaultKeybindings : [];
    const allBindings = buildAll(defs);
    const ruleCount = allBindings.length;

    const results = {
      bindings: allBindings,
      totalBindings: allBindings.length,
      ruleCount: ruleCount,
    };

    if (results && results.totalBindings > 0) {
      const out = JSON.stringify(results.bindings, null, 2);

      if (isDryRunMode()) {
        fs.writeFileSync(dryRunPath, out, "utf8");
      }

      if (isLiveMode()) {
        try {
          const keybindingsPath = getKeybindingsPath();
          fs.writeFileSync(keybindingsPath, out, "utf8");

          await updateSkipShellSettings();
        } catch (err) {
          vscode.window.showErrorMessage(
            `Failed to update keybindings: ${err.message}`,
          );
        }
      }

      vscode.window.setStatusBarMessage(
        `Superkeys: ${results.totalBindings} keybindings applied`,
        3000,
      );
    } else {
      vscode.window.showWarningMessage("No keybinding rules were applied.");
    }
  } catch (err) {
    vscode.window.showErrorMessage(
      `Failed to apply keybindings config: ${err.message}`,
    );
  } finally {
    delete global.Rule;
    delete global.When;
    delete global.Command;

    isApplying = false;
  }
}

async function writeOutView(viewName) {
  const view = VIEWS[viewName];
  if (!view) {
    vscode.window.showErrorMessage(`View "${viewName}" not found.`);
    return;
  }

  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!folder) {
    vscode.window.showErrorMessage("No workspace folder open.");
    return;
  }

  const useClipboard = isUseClipboard();
  const outputFilename = vscode.workspace
    .getConfiguration("superkeys")
    .get("viewOutputFilename", "__dump.txt");
  const outputPath = path.join(folder, outputFilename);

  view._setRootPath(folder);
  view._setOutputPath(outputPath);

  try {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");

    // Collect files matching the view criteria
    view.populate();

    // Generate the content
    view.generate();

    if (useClipboard) {
      // Copy to clipboard
      await vscode.env.clipboard.writeText(view.content);

      vscode.window.showInformationMessage(
        `View "${view.name}" copied to clipboard (${
          view.files.length
        } files, ${formatBytes(view.sizeBytes)})`,
      );
    } else {
      // Write to file and open
      view.writeToFile();

      const doc = await vscode.workspace.openTextDocument(outputPath);
      await vscode.window.showTextDocument(doc);
    }
  } catch (err) {
    vscode.window.showErrorMessage(`Failed to run view: ${err.message}`);
  }
}

// Helper function to format bytes (moved from view.cjs for convenience)
function formatBytes(b) {
  if (b === 0) return "0 B";
  const k = 1024,
    s = ["B", "KB", "MB", "GB"],
    i = Math.floor(Math.log(b) / Math.log(k));
  return (b / Math.pow(k, i)).toFixed(1) + " " + s[i];
}

async function openViewInWorkspace(viewName) {
  const view = VIEWS[viewName];
  if (!view) {
    vscode.window.showErrorMessage(`View "${viewName}" not found.`);
    return;
  }

  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!folder) {
    vscode.window.showErrorMessage("No workspace folder open.");
    return;
  }

  view._setRootPath(folder);

  try {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");

    view.populate();

    const files = view._getFiles();

    for (const file of files) {
      if (fs.existsSync(file)) {
        const doc = await vscode.workspace.openTextDocument(file);
        await vscode.window.showTextDocument(doc, {
          preview: false,
        });
      }
    }
  } catch (err) {
    vscode.window.showErrorMessage(`Failed to open view: ${err.message}`);
  }
}

function deactivate() {
  if (configWatcher) {
    configWatcher.dispose();
  }
  if (outputChannel) {
    outputChannel.dispose();
  }
}

module.exports = {
  activate,
  deactivate,
};
