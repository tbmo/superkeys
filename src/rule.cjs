const ActionRegistry = Object.create(null);
const BIND_RULES = [];
const SKIP_SHELL_COMMANDS = new Set();

let WORKSPACE_ROOT = null;

function setWorkspaceRoot(absPath) {
  if (!absPath) {
    WORKSPACE_ROOT = null;
    return;
  }
  // normalize, strip trailing slash
  WORKSPACE_ROOT = String(absPath).replace(/\\/g, "/").replace(/\/+$/, "");
}

function isUriLike(s) {
  return typeof s === "string" && /^[a-z][a-z0-9+.-]*:\/\//i.test(s);
}
function isAbsoluteFsPath(s) {
  return (
    typeof s === "string" &&
    (/^[A-Za-z]:[\\/]/.test(s) || // Windows C:\...
      s.startsWith("/")) // POSIX /home/...
  );
}
function resolveWorkspacePath(p) {
  const s = String(p);
  if (isUriLike(s)) return s; // leave URIs as-is
  if (isAbsoluteFsPath(s)) return s.replace(/\\/g, "/");
  // relative -> prefix with workspace root if we have it
  if (WORKSPACE_ROOT) return `${WORKSPACE_ROOT}/${s}`.replace(/\\/g, "/");
  // no workspace root set: leave relative (best-effort)
  return s.replace(/\\/g, "/");
}

function a(name) {
  return new Action(name);
}

class Action {
  constructor(name) {
    this.name = name;
    this.steps = [];
    this.bindings = [];
  }

  command(cmd, args) {
    if (cmd && cmd instanceof Action) {
      this.steps.push({ command: cmd.name });
    } else if (typeof cmd === "string") {
      const entry = args ? { command: cmd, args } : cmd;
      this.steps.push(entry);
    } else if (cmd && cmd.command) {
      this.steps.push(args ? { ...cmd, args } : cmd);
    }
    return this;
  }

  execute(shell) {
    this.steps.push({
      command: "workbench.action.terminal.sendSequence",
      args: { text: `cd \${workspaceFolder}; ${shell}\r` },
    });
    return this;
  }

  focus() {
    this.steps.push({ command: "workbench.action.terminal.focus" });
    return this;
  }

  open(path) {
    const full = resolveWorkspacePath(path);
    this.steps.push({
      command: "vscode.open",
      args: {
        scheme: "file",
        path: full,
      },
    });
    return this;
  }

  bind(key, exclusions = []) {
    // Simple API: just pass the key and an optional array of command names to exclude
    this.bindings.push({
      key: key,
      exclusions: Array.isArray(exclusions) ? exclusions : [exclusions],
    });
    return this;
  }

  write() {
    ActionRegistry[this.name] = this;

    for (const s of this._flatten()) {
      if (typeof s === "string") SKIP_SHELL_COMMANDS.add(s);
      else if (s && s.command) SKIP_SHELL_COMMANDS.add(s.command);
    }

    for (const b of this.bindings) {
      BIND_RULES.push({
        action: this.name,
        key: b.key,
        exclusions: b.exclusions,
      });
    }

    return this.name;
  }

  _flatten(seen = new Set()) {
    if (seen.has(this.name)) {
      throw new Error(`Cycle detected: ${[...seen, this.name].join(" -> ")}`);
    }
    seen.add(this.name);

    const out = [];
    for (const entry of this.steps) {
      if (typeof entry === "string") {
        const ref = ActionRegistry[entry];
        if (ref) out.push(...ref._flatten(new Set(seen)));
        else {
          SKIP_SHELL_COMMANDS.add(entry);
          out.push(entry);
        }
      } else if (entry && typeof entry === "object" && entry.command) {
        const ref = ActionRegistry[entry.command];
        if (ref && !entry.args) out.push(...ref._flatten(new Set(seen)));
        else {
          SKIP_SHELL_COMMANDS.add(entry.command);
          out.push(entry);
        }
      }
    }
    return out;
  }
}

function normalizeKey(k) {
  return String(k)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\+/g, "+")
    .trim();
}

function buildAll(defaultKeybindings) {
  const bindings = [];
  const defs = Array.isArray(defaultKeybindings) ? defaultKeybindings : [];

  for (const rule of BIND_RULES) {
    const act = ActionRegistry[rule.action];
    const normalizedKey = normalizeKey(rule.key);

    // First, disable all default bindings for this key except the exclusions
    const existingBindings = defs.filter(
      (b) => normalizeKey(b.key) === normalizedKey,
    );

    for (const existing of existingBindings) {
      // If this command is in our exclusions list, keep it
      if (rule.exclusions && rule.exclusions.includes(existing.command)) {
        bindings.push({ ...existing });
      } else {
        // Otherwise disable it
        bindings.push({ key: rule.key, command: `-${existing.command}` });
      }
    }

    // Now add our new binding
    if (act) {
      const seq = act._flatten();
      const binding = { key: rule.key };

      if (seq.length === 1) {
        const only = seq[0];
        if (typeof only === "string") {
          binding.command = only;
        } else if (only && !only.args) {
          binding.command = only.command;
        } else {
          binding.command = "runCommands";
          binding.args = { commands: [only] };
        }
      } else {
        binding.command = "runCommands";
        binding.args = { commands: seq };
      }

      // Build the when clause: our binding fires when all exclusions are false
      if (rule.exclusions && rule.exclusions.length > 0) {
        // Find the when conditions for excluded commands from defaults
        const whenConditions = [];

        for (const excludedCmd of rule.exclusions) {
          const defaultBinding = defs.find(
            (b) =>
              b.command === excludedCmd &&
              normalizeKey(b.key) === normalizedKey,
          );

          if (defaultBinding && defaultBinding.when) {
            // Negate the when condition
            whenConditions.push(`!(${defaultBinding.when})`);
          }
        }

        // Combine all negated conditions with AND
        if (whenConditions.length > 0) {
          binding.when = whenConditions.join(" && ");
        }
      }

      bindings.push(binding);
    }
  }

  return bindings;
}

// Shortcuts
Action.prototype.c = Action.prototype.command;
Action.prototype.e = Action.prototype.execute;
Action.prototype.w = Action.prototype.write;
Action.prototype.b = Action.prototype.bind;
Action.prototype.f = Action.prototype.focus;
Action.prototype.o = Action.prototype.open;

function getSkipShellCommands() {
  return Array.from(SKIP_SHELL_COMMANDS);
}

function clearSkipShellCommands() {
  SKIP_SHELL_COMMANDS.clear();
}

module.exports = {
  a,
  buildAll,
  getSkipShellCommands,
  clearSkipShellCommands,
  setWorkspaceRoot,
};
