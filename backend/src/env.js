const fs = require("node:fs");
const path = require("node:path");

let loaded = false;

function loadEnv() {
  if (loaded) {
    return;
  }
  loaded = true;

  const files = [
    path.resolve(__dirname, "../../.env"),
    path.resolve(__dirname, "../.env"),
  ];

  for (const file of files) {
    if (fs.existsSync(file)) {
      loadEnvFile(file);
    }
  }
}

function loadEnvFile(file) {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");
    if (separator <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    const value = parseEnvValue(trimmed.slice(separator + 1).trim());
    if (/^[A-Z_][A-Z0-9_]*$/i.test(key) && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function parseEnvValue(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  const commentIndex = value.indexOf(" #");
  return commentIndex >= 0 ? value.slice(0, commentIndex).trim() : value;
}

module.exports = {
  loadEnv,
};
