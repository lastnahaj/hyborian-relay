import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extname } from "node:path";

const sourceExtensions = new Set([
  ".cjs",
  ".css",
  ".env",
  ".html",
  ".ini",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".mts",
  ".sh",
  ".ts",
  ".txt",
  ".yaml",
  ".yml",
]);
const extensionlessSourceFiles = new Set(["Dockerfile", ".gitignore", ".dockerignore"]);
const joined = (...fragments) => fragments.join("");
const patterns = [
  { label: "unfinished marker", expression: new RegExp(`\\b${joined("TO", "DO")}\\b`, "iu") },
  { label: "unfinished marker", expression: new RegExp(`\\b${joined("FIX", "ME")}\\b`, "iu") },
  {
    label: "unfinished marker",
    expression: new RegExp(`\\b${joined("PLACE", "HOLDER")}\\b`, "iu"),
  },
  { label: "unfinished implementation", expression: /not[ -]implemented/iu },
  { label: "unfinished implementation", expression: /coming[ -]soon/iu },
  {
    label: "development provenance",
    expression: new RegExp(`\\b${joined("Open", "A", "I")}\\b`, "iu"),
  },
  {
    label: "development provenance",
    expression: new RegExp(`\\b${joined("Chat", "G", "P", "T")}\\b`, "iu"),
  },
  { label: "development provenance", expression: new RegExp(`\\b${joined("Code", "x")}\\b`, "iu") },
  { label: "development provenance", expression: new RegExp(`\\b${joined("G", "PT")}\\b`, "iu") },
  { label: "development provenance", expression: new RegExp(`\\b${joined("A", "I")}\\b`, "u") },
  { label: "development provenance", expression: /language[ -]models?/iu },
  {
    label: "development provenance",
    expression: new RegExp(joined("artificial", " intelligence"), "iu"),
  },
  { label: "development provenance", expression: /automated[ -]code[ -]generation/iu },
  { label: "development provenance", expression: /machine[ -]written[ -]code/iu },
  { label: "publishing value", expression: new RegExp(joined("example", "\\.com"), "iu") },
  { label: "publishing value", expression: /your[-_](?:server|token|repository|name)/iu },
  {
    label: "publishing value",
    expression: new RegExp(`${joined("replace", "_me")}|${joined("change", "_me")}`, "iu"),
  },
  { label: "publishing value", expression: new RegExp(joined("sample", " project"), "iu") },
  { label: "publishing value", expression: new RegExp(joined("test", " project"), "iu") },
  { label: "artificial example name", expression: new RegExp(`\\b${joined("Al", "ex")}\\b`, "u") },
  {
    label: "artificial example name",
    expression: new RegExp(`\\b${joined("Shi", "karu")}\\b`, "u"),
  },
  { label: "artificial example name", expression: new RegExp(`\\b${joined("Ali", "ce")}\\b`, "u") },
  { label: "artificial example name", expression: new RegExp(`\\b${joined("B", "ob")}\\b`, "u") },
  {
    label: "artificial example name",
    expression: new RegExp(`\\b${joined("Char", "lie")}\\b`, "u"),
  },
  {
    label: "artificial example name",
    expression: new RegExp(`\\b${joined("John", " Doe")}\\b`, "u"),
  },
  {
    label: "artificial example name",
    expression: new RegExp(`\\b${joined("Jane", " Doe")}\\b`, "u"),
  },
  { label: "artificial example name", expression: /\b(?:Player|User)[12]\b/u },
  {
    label: "artificial example name",
    expression: new RegExp(`\\b${joined("Test", "User")}\\b`, "u"),
  },
  {
    label: "artificial example name",
    expression: new RegExp(`\\b${joined("Example", "Player")}\\b`, "u"),
  },
  { label: "artificial example name", expression: new RegExp(`\\b${joined("F", "oo")}\\b`, "u") },
  { label: "artificial example name", expression: new RegExp(`\\b${joined("B", "ar")}\\b`, "u") },
];

function repositoryFiles() {
  const output = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { encoding: "utf8" },
  );
  return output.split("\0").filter(Boolean);
}

function shouldScan(path) {
  const filename = path.split(/[\\/]/u).at(-1) ?? path;
  return sourceExtensions.has(extname(filename)) || extensionlessSourceFiles.has(filename);
}

const violations = [];
for (const path of repositoryFiles().filter(shouldScan)) {
  const content = readFileSync(path, "utf8");
  if (content.includes("\0")) continue;
  for (const [index, line] of content.split(/\r?\n/u).entries()) {
    for (const pattern of patterns) {
      if (pattern.expression.test(line)) violations.push(`${path}:${index + 1}: ${pattern.label}`);
    }
  }
}

if (violations.length > 0) {
  process.stderr.write(`Public source verification failed:\n${violations.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("Public source verification passed.\n");
}
