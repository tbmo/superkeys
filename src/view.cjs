const fs = require("fs");
const micromatch = require("micromatch");
const ignore = require("ignore");
const path = require("path");

const VIEWS = {};
const DEFAULT_EXCLUDES = ["node_modules/**", ".git/**", ".cache/**"];

class Command {
  constructor(type, pattern, include) {
    this.type = type; // 'view' | 'glob' | 'content'
    this.pattern = pattern;
    this.include = include;
  }

  matches(filePath, view) {
    switch (this.type) {
      case "view":
        const refView = VIEWS[this.pattern];
        return refView && refView.shouldIncludeFile(filePath);
      case "glob":
        const normalized = filePath.replace(/\\/g, "/");
        return micromatch.isMatch(normalized, this.pattern, { dot: true });
      case "content":
        return this._contentMatches(filePath, view);
      default:
        return false;
    }
  }

  _contentMatches(filePath, view) {
    if (!view.rootPath) return false;
    try {
      const fullPath = path.join(view.rootPath, filePath);
      const content = fs.readFileSync(fullPath, "utf8");
      if (this.pattern.startsWith("/") && this.pattern.endsWith("/")) {
        const regex = new RegExp(this.pattern.slice(1, -1), "i");
        return regex.test(content);
      }
      return content.includes(this.pattern);
    } catch {
      return false;
    }
  }
}

function v(name = "default", inclusive = false) {
  return new View(name, inclusive);
}

class View {
  constructor(name = "default", inclusive = false) {
    this.name = name;
    this.hidden = false;
    this.inclusive = inclusive;
    this.commands = [];
    this.headerOnly = false;
    this.maxDepth = 100;
    this.headerPrompt = null;
    this.writeDebug = false;
    this.sizeBytes = 0;
    this._ignore = ignore();
    this.files = null;
    this.content = null;
    this.rootPath = null;
    this.outputPath = null;
    this._outputChannel = null;

    DEFAULT_EXCLUDES.forEach((p) => this.excludeGlob(p));
  }

  _addCommand(type, pattern, include) {
    this.commands.push(new Command(type, pattern, include));
    return this;
  }

  _wrapPattern(pattern, beg, end) {
    if (beg) pattern = `**/${pattern}`;
    if (end) pattern = `${pattern}/**`;
    return pattern;
  }

  _handleOptionalArray(arg, fn) {
    if (Array.isArray(arg)) arg.forEach(fn);
    else if (typeof arg === "string") fn(arg);
    return this;
  }

  // View commands
  includeView(name) {
    return this._handleOptionalArray(name, (n) =>
      this._addCommand("view", n, true),
    );
  }
  excludeView(name) {
    return this._handleOptionalArray(name, (n) =>
      this._addCommand("view", n, false),
    );
  }

  // Glob commands
  includeGlob(pattern, beg = false, end = false) {
    return this._handleOptionalArray(pattern, (p) =>
      this._addCommand("glob", this._wrapPattern(p, beg, end), true),
    );
  }
  excludeGlob(pattern, beg = false, end = false) {
    return this._handleOptionalArray(pattern, (p) =>
      this._addCommand("glob", this._wrapPattern(p, beg, end), false),
    );
  }

  // Content commands
  includeContentPattern(pattern) {
    return this._handleOptionalArray(pattern, (p) =>
      this._addCommand("content", p, true),
    );
  }
  excludeContentPattern(pattern) {
    return this._handleOptionalArray(pattern, (p) =>
      this._addCommand("content", p, false),
    );
  }

  shouldIncludeFile(filePath) {
    let included = this.inclusive; // start true if inclusive, false if exclusive

    for (const cmd of this.commands) {
      if (cmd.matches(filePath, this)) {
        included = cmd.include;
      }
    }

    return included;
  }

  // Rest of the class - unchanged functionality

  _getFiles() {
    if (!this.files)
      throw new Error("Files list is not set. Call collect() first.");
    return this.files;
  }

  _setRootPath(rootPath) {
    this.rootPath = rootPath;
    const gitignorePath = path.join(rootPath, ".gitignore");
    if (fs.existsSync(gitignorePath)) {
      this._ignore.add(fs.readFileSync(gitignorePath, "utf8"));
    }
  }

  _setOutputPath(p) {
    this.outputPath = p;
  }
  _print(msg) {}

  debug() {
    this.writeDebug = true;
    return this;
  }
  nobody() {
    this.headerOnly = true;
    return this;
  }
  prompt(p) {
    this.headerPrompt = p;
    return this;
  }
  private() {
    this.hidden = true;
    return this;
  }

  write() {
    VIEWS[this.name] = this;
    return this;
  }

  _walk(dir, currentDepth = 0) {
    if (currentDepth >= this.maxDepth) return;

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(this.rootPath, full).replace(/\\/g, "/");

      if (this._ignore.ignores(rel)) continue;

      // Check if excluded by glob BEFORE descending/reading
      if (this._isHardExcluded(rel)) continue;

      if (entry.isDirectory()) {
        this._walk(full, currentDepth + 1);
      } else {
        if (this.shouldIncludeFile(rel)) {
          this.sizeBytes += fs.statSync(full).size;
          this.files.push(full);
        }
      }
    }
  }

  _isHardExcluded(filePath) {
    // Check only glob excludes from DEFAULT_EXCLUDES
    for (const cmd of this.commands) {
      if (cmd.type === "glob" && !cmd.include) {
        if (micromatch.isMatch(filePath, cmd.pattern, { dot: true })) {
          return true;
        }
      }
    }
    return false;
  }

  populate() {
    this._print(`Collecting files for view "${this.name}" in ${this.rootPath}`);
    this._outputChannel?.appendLine(
      `Collecting files for view "${this.name}" in ${this.rootPath}`,
    );
    this.files = [];
    this.sizeBytes = 0;
    this._walk(this.rootPath);
  }

  generate() {
    const header = this._generateHeader();

    if (this.headerOnly) {
      this.content = header;
      return this.content;
    }

    const fileContents = [];
    this.files.forEach((fullPath) => {
      const content = fs.readFileSync(fullPath, "utf8");
      fileContents.push(`${"=".repeat(80)}`);
      fileContents.push(`File: ${fullPath}`);
      fileContents.push(`${"=".repeat(80)}`);
      fileContents.push(content);
    });

    this.content = header + "\n\n" + fileContents.join("\n");
    return this.content;
  }

  writeToFile() {
    if (!this.content) this.generate();
    fs.writeFileSync(this.outputPath, this.content, "utf8");
    this._print(`✅ View written to ${this.outputPath}`);
    return this.outputPath;
  }

  writeFileManifest() {
    return this.writeToFile();
  }

  _generateHeader() {
    let header = this._generateTreeHeader();

    if (this.headerPrompt) {
      header += "\n\n" + "=".repeat(80) + "\n";
      header += "PROMPT\n";
      header += "=".repeat(80) + "\n";
      header += this.headerPrompt;
    }

    if (this.writeDebug) {
      header += "\n\n" + "=".repeat(80) + "\n";
      header += "DEBUG INFO\n";
      header += "=".repeat(80) + "\n";
      header += this._getDebugInfo();
    }

    return header;
  }

  _generateTreeHeader() {
    const lines = [];
    lines.push(`# ${this.name}`);
    lines.push("");
    lines.push(`Total files: ${this.files.length}`);
    lines.push(`Total size: ${formatBytes(this.sizeBytes)}`);
    lines.push("");

    const tree = {};
    this.files.forEach((fullPath) => {
      const parts = fullPath.replace(/\\/g, "/").split("/");
      let current = tree;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!current[parts[i]]) current[parts[i]] = {};
        current = current[parts[i]];
      }
      current[parts[parts.length - 1]] = {
        _isFile: true,
        _size: fs.statSync(fullPath).size,
      };
    });

    function renderTree(node, prefix = "") {
      const entries = Object.entries(node)
        .filter(([key]) => !key.startsWith("_"))
        .sort(([aKey, aVal], [bKey, bVal]) => {
          const aIsFile = aVal._isFile || false;
          const bIsFile = bVal._isFile || false;
          if (!aIsFile && bIsFile) return -1;
          if (aIsFile && !bIsFile) return 1;
          return aKey.localeCompare(bKey);
        });

      entries.forEach(([name, child], i) => {
        const isLast = i === entries.length - 1;
        const connector = isLast ? "└── " : "├── ";
        const newPrefix = prefix + (isLast ? "    " : "│   ");

        if (child._isFile) {
          lines.push(`${prefix}${connector}${name}`);
        } else {
          lines.push(`${prefix}${connector}${name}/`);
          renderTree(child, newPrefix);
        }
      });
    }

    renderTree(tree);
    return lines.join("\n");
  }

  _getDebugInfo(indent = 0) {
    const pad = " ".repeat(indent);
    const lines = [
      `${pad}View: ${this.name}`,
      `${pad}  Inclusive: ${this.inclusive}`,
      `${pad}  Commands (in order):`,
    ];
    this.commands.forEach((cmd, i) => {
      lines.push(
        `${pad}    ${i}: ${cmd.include ? "+" : "-"}${cmd.type}(${cmd.pattern})`,
      );
    });
    return lines.join("\n");
  }

  getDebugGlobs(indent = 0) {
    return this._getDebugInfo(indent);
  }
}

// Aliases
View.prototype.ig = View.prototype.includeGlob;
View.prototype.xg = View.prototype.excludeGlob;
View.prototype.iv = View.prototype.includeView;
View.prototype.xv = View.prototype.excludeView;
View.prototype.ip = View.prototype.includeContentPattern;
View.prototype.xp = View.prototype.excludeContentPattern;
View.prototype.w = View.prototype.write;

function formatBytes(b) {
  if (b === 0) return "0 B";
  const k = 1024,
    s = ["B", "KB", "MB", "GB"],
    i = Math.floor(Math.log(b) / Math.log(k));
  return (b / Math.pow(k, i)).toFixed(1) + " " + s[i];
}

function getPublicViews() {
  return Object.fromEntries(
    Object.entries(VIEWS).filter(([, view]) => !view.hidden),
  );
}

module.exports = { v, VIEWS, getPublicViews };
