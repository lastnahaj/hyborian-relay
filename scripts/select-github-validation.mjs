import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const foundationFiles = new Set([
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "tsconfig.test.json",
  "eslint.config.mjs",
  "prettier.config.mjs",
  "vitest.config.ts",
  "knip.json",
  "jscpd.json",
]);

export function selectValidationCategories(changedPaths) {
  const categories = new Set();
  for (const unnormalizedPath of changedPaths) {
    const path = unnormalizedPath.replaceAll("\\", "/").replace(/^\.\//u, "");
    if (path === "") continue;
    if (
      foundationFiles.has(path) ||
      path === "scripts/select-github-validation.mjs" ||
      path.startsWith(".github/workflows/")
    ) {
      categories.add("full");
    } else if (/\.(?:md|txt)$/iu.test(path) || path === "SECURITY.md") {
      categories.add("documentation");
    } else if (path === "Dockerfile" || path === "docker-compose.yml" || path === ".dockerignore") {
      categories.add("docker");
    } else if (path.startsWith("packaging/") || /^scripts\/.*\.sh$/u.test(path)) {
      categories.add("linux-packaging");
    } else if (path.startsWith("src/configuration/") || path === ".env.example") {
      categories.add("configuration");
      categories.add("typescript-source");
    } else if (path.startsWith("src/conan/rcon/") || path.startsWith("tests/rcon/")) {
      categories.add("rcon");
      categories.add("typescript-source");
    } else if (path.startsWith("src/chat/") || path.startsWith("tests/chat/")) {
      categories.add("chat");
      categories.add("typescript-source");
    } else if (path.startsWith("src/conan/logs/") || path.startsWith("tests/game-events/")) {
      categories.add("game-events");
      categories.add("chat");
      categories.add("death-tracking");
      categories.add("typescript-source");
    } else if (path.startsWith("src/tracking/") || path.startsWith("tests/tracking/")) {
      categories.add("player-tracking");
      categories.add("death-tracking");
      categories.add("typescript-source");
    } else if (path.startsWith("src/storage/") || path.startsWith("tests/storage/")) {
      categories.add("storage");
      categories.add("player-tracking");
      categories.add("death-tracking");
      categories.add("typescript-source");
    } else if (path.startsWith("src/discord/") || path.startsWith("tests/discord/")) {
      categories.add("discord");
      categories.add("chat");
      categories.add("typescript-source");
    } else if (path.endsWith(".ts")) {
      categories.add("typescript-source");
      categories.add("full");
    } else {
      categories.add("full");
    }
  }
  return [...categories].sort();
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const paths = process.argv.slice(2);
  const changedPaths = paths.length > 0 ? paths : readFileSync(0, "utf8").split(/\r?\n/u);
  process.stdout.write(`${JSON.stringify(selectValidationCategories(changedPaths))}\n`);
}
