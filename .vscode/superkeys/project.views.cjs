const globs = [
  "**/extension.js",
  "**/package.json",
  "**/rule.cjs",
  "**/types-generator.cjs",
  "**/view.cjs",
  "**/.vscode/superkeys/**",
];
v("all").ig(globs).w();
v("inc").xv("all").debug().w();
