import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, URL } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const docsRoot = join(repositoryRoot, "docs");
const publicRoot = join(repositoryRoot, "public");
const mediaRoot = join(publicRoot, "media");
const validStatuses = new Set(["verified", "server-verification-required", "draft"]);
const validSourceStatuses = new Set(["checked", "author-linked"]);
const imageExtensions = new Set([".avif", ".gif", ".jpeg", ".jpg", ".png", ".webp"]);
const joined = (...fragments) => fragments.join("");
const errors = [];
const warnings = [];

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    errors.push(`${relative(repositoryRoot, path)} is not valid JSON: ${error.message}`);
    return undefined;
  }
}

function walkFiles(root) {
  if (!existsSync(root)) return [];

  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? walkFiles(path) : [path];
  });
}

function routeForMarkdown(path) {
  const pathFromDocs = relative(docsRoot, path).split(sep).join("/");
  if (pathFromDocs === "index.md") return "/";
  if (pathFromDocs.endsWith("/index.md")) return `/${pathFromDocs.slice(0, -8)}`;
  return `/${pathFromDocs.slice(0, -3)}`;
}

function frontmatterStatus(markdown) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return undefined;
  return match[1].match(/^verification:\s*(.+)$/m)?.[1]?.trim();
}

function resolvedMarkdownTarget(sourcePath, rawTarget) {
  const target = rawTarget.split("#")[0].split("?")[0];
  if (!target || /^(?:https?:|mailto:|tel:)/i.test(target)) return undefined;

  const decoded = decodeURIComponent(target);
  const base = decoded.startsWith("/")
    ? join(docsRoot, decoded)
    : resolve(sourcePath, "..", decoded);
  const candidates = extname(base) ? [base] : [`${base}.md`, join(base, "index.md")];

  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
}

const modsRegistry = readJson(join(repositoryRoot, "data", "mods.json"));
const imageRegistry = readJson(join(repositoryRoot, "data", "image-sources.json"));
const sourcesRegistry = readJson(join(repositoryRoot, "data", "sources.json"));
const verificationRegistry = readJson(join(repositoryRoot, "data", "verification.json"));
const catalog = readJson(join(repositoryRoot, "data", "catalogs", "highmanes-arsenal.json"));

if (modsRegistry) {
  const ids = new Set();
  if (!Array.isArray(modsRegistry.mods) || modsRegistry.mods.length !== 20) {
    errors.push("data/mods.json must contain the 20 supplied Workshop entries.");
  } else {
    for (const mod of modsRegistry.mods) {
      if (!/^\d{10}$/.test(mod.workshop_id ?? "")) {
        errors.push(`Invalid Workshop ID for ${mod.name ?? "unnamed mod"}.`);
      }
      if (ids.has(mod.workshop_id)) errors.push(`Duplicate Workshop ID ${mod.workshop_id}.`);
      ids.add(mod.workshop_id);
      if (!mod.name || /\.pak\b/i.test(mod.name)) {
        errors.push(`Mod ${mod.workshop_id ?? "unknown"} lacks a canonical public name.`);
      }
      if (!Array.isArray(mod.source_urls) || mod.source_urls.length === 0) {
        errors.push(`Mod ${mod.workshop_id ?? "unknown"} has no source URL.`);
      }
      if (!validStatuses.has(mod.verification_status)) {
        errors.push(`Mod ${mod.workshop_id ?? "unknown"} has an invalid verification status.`);
      }
      if (!mod.workshop_url?.includes(`id=${mod.workshop_id}`)) {
        errors.push(
          `Mod ${mod.workshop_id ?? "unknown"} does not link to its exact Workshop page.`,
        );
      }
    }
  }
}

const registeredSourceUrls = new Set();
if (!sourcesRegistry || !Array.isArray(sourcesRegistry.sources)) {
  errors.push("data/sources.json must contain a sources array.");
} else {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sourcesRegistry.checked_at ?? "")) {
    errors.push("data/sources.json has no valid audit date.");
  }

  const sourceKeys = new Set();
  const knownModIds = new Set(modsRegistry?.mods?.map((mod) => mod.workshop_id) ?? []);

  for (const source of sourcesRegistry.sources) {
    if (!source.key || sourceKeys.has(source.key)) {
      errors.push(`Source key ${source.key ?? "missing"} is missing or duplicated.`);
    }
    sourceKeys.add(source.key);

    if (!source.url || registeredSourceUrls.has(source.url)) {
      errors.push(`Source URL ${source.url ?? "missing"} is missing or duplicated.`);
    }
    registeredSourceUrls.add(source.url);

    if (!validSourceStatuses.has(source.status)) {
      errors.push(`Source ${source.key ?? "unknown"} has invalid status ${source.status}.`);
    }
    if (!source.kind || !source.edition_scope || !source.use) {
      errors.push(`Source ${source.key ?? "unknown"} lacks role or edition metadata.`);
    }
    if (!Array.isArray(source.mod_ids) || source.mod_ids.length === 0) {
      errors.push(`Source ${source.key ?? "unknown"} has no associated mod ID.`);
    }
    for (const modId of source.mod_ids ?? []) {
      if (!knownModIds.has(modId)) {
        errors.push(`Source ${source.key ?? "unknown"} references unknown mod ID ${modId}.`);
      }
    }
  }

  for (const mod of modsRegistry?.mods ?? []) {
    const workshopSource = sourcesRegistry.sources.find(
      (source) => source.url === mod.workshop_url && source.kind === "steam-workshop",
    );
    if (
      !workshopSource ||
      workshopSource.status !== "checked" ||
      workshopSource.edition_scope !== "enhanced"
    ) {
      errors.push(`Mod ${mod.workshop_id} lacks a checked Enhanced Workshop source record.`);
    }
    for (const sourceUrl of mod.source_urls ?? []) {
      if (!registeredSourceUrls.has(sourceUrl)) {
        errors.push(`Mod ${mod.workshop_id} uses unregistered source ${sourceUrl}.`);
      }
    }
  }
}

const markdownFiles = walkFiles(docsRoot).filter((path) => extname(path) === ".md");
const markdownRoutes = new Set(markdownFiles.map(routeForMarkdown));

if (verificationRegistry?.pages) {
  for (const markdownPath of markdownFiles) {
    const route = routeForMarkdown(markdownPath);
    const record = verificationRegistry.pages[route];
    const markdown = readFileSync(markdownPath, "utf8");
    const status = frontmatterStatus(markdown);

    if (!record) {
      errors.push(`${relative(repositoryRoot, markdownPath)} has no verification registry entry.`);
      continue;
    }
    if (!validStatuses.has(record.status)) {
      errors.push(`${route} has invalid verification status ${record.status}.`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(record.verified_at ?? "")) {
      errors.push(`${route} has no valid verification date.`);
    }
    if (!Array.isArray(record.source_urls)) {
      errors.push(`${route} must provide a source_urls array.`);
    }
    if (record.status === "draft") {
      errors.push(`${route} is marked draft but would be included in the public build.`);
    }
    if (status && status !== record.status) {
      errors.push(`${route} frontmatter status does not match data/verification.json.`);
    }
    if (record.status === "server-verification-required") {
      warnings.push(`${route}: live-server verification remains required.`);
    }

    const publicSafetyPatterns = [
      /\bCharVars?\b/i,
      /\bGlobVars?\b/i,
      /\bMushiString\b/i,
      /\bRCON\b/i,
      /\bspawn commands?\b/i,
      /\bnode graphs?\b/i,
    ];
    for (const pattern of publicSafetyPatterns) {
      if (pattern.test(markdown)) {
        errors.push(
          `${relative(repositoryRoot, markdownPath)} contains internal-only terminology.`,
        );
      }
    }

    if (/\.(?:pak)\b/i.test(markdown)) {
      errors.push(`${relative(repositoryRoot, markdownPath)} exposes a package filename.`);
    }
    const authorshipPattern = new RegExp(
      `\\b(?:${joined("Open", "A", "I")}|${joined("Chat", "G", "P", "T")}|${joined("Code", "x")}|${joined("artificial", " intelligence")})\\b`,
      "i",
    );
    if (authorshipPattern.test(markdown)) {
      errors.push(
        `${relative(repositoryRoot, markdownPath)} contains prohibited authorship wording.`,
      );
    }

    const links = markdown.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g);
    for (const link of links) {
      const target = link[1];
      if (!resolvedMarkdownTarget(markdownPath, target)) {
        const cleanTarget = target.split("#")[0].split("?")[0];
        if (cleanTarget && !/^(?:https?:|mailto:|tel:)/i.test(cleanTarget)) {
          errors.push(`${relative(repositoryRoot, markdownPath)} has broken link ${target}.`);
        }
      }
    }
  }

  for (const route of Object.keys(verificationRegistry.pages)) {
    if (!markdownRoutes.has(route))
      errors.push(`Verification entry ${route} has no Markdown page.`);
  }
} else {
  errors.push("data/verification.json must contain a pages object.");
}

if (catalog) {
  if (!Array.isArray(catalog.source_urls) || catalog.source_urls.length === 0) {
    errors.push("The Highmane catalog has no source URL.");
  }
  for (const category of catalog.categories ?? []) {
    for (const entry of category.entries ?? []) {
      if (!validStatuses.has(entry.verification_status)) {
        errors.push(`Catalog entry ${entry.name ?? "unnamed"} has an invalid verification status.`);
      }
      if (entry.verification_status === "verified" && entry.source_urls?.length === 0) {
        errors.push(`Verified catalog entry ${entry.name ?? "unnamed"} has no source URL.`);
      }
      if (entry.verification_status === "verified" && entry.obtainable !== true) {
        errors.push(`Verified catalog entry ${entry.name ?? "unnamed"} is not player-obtainable.`);
      }
    }
  }
}

const localImages = imageRegistry?.local_images;
if (!Array.isArray(localImages)) {
  errors.push("data/image-sources.json must contain a local_images array.");
} else {
  const registeredPaths = new Set();
  const requiredImageFields = [
    "local_path",
    "source_page",
    "source_asset",
    "mod_id",
    "mod_name",
    "credit",
    "verified_at",
    "alt",
  ];

  for (const image of localImages) {
    for (const field of requiredImageFields) {
      if (!image[field]) errors.push(`Image entry is missing ${field}.`);
    }
    if (image.local_path) {
      registeredPaths.add(image.local_path.replaceAll("/", sep));
      if (!existsSync(join(repositoryRoot, image.local_path))) {
        errors.push(`Registered image ${image.local_path} does not exist.`);
      }
    }
  }

  for (const imagePath of walkFiles(mediaRoot).filter((path) =>
    imageExtensions.has(extname(path)),
  )) {
    const pathFromRoot = relative(repositoryRoot, imagePath);
    if (!registeredPaths.has(pathFromRoot)) {
      errors.push(`${pathFromRoot} has no image provenance entry.`);
    }
  }
}

for (const approvedSource of imageRegistry?.approved_source_pages ?? []) {
  for (const sourcePage of approvedSource.source_pages ?? []) {
    if (!registeredSourceUrls.has(sourcePage)) {
      errors.push(`Approved image source ${sourcePage} is missing from data/sources.json.`);
    }
  }
}

for (const warning of warnings) console.warn(`wiki verification warning: ${warning}`);

if (errors.length > 0) {
  for (const error of errors) console.error(`wiki verification error: ${error}`);
  process.exitCode = 1;
} else {
  console.log(
    `Wiki verification passed: ${markdownFiles.length} pages, ${modsRegistry?.mods?.length ?? 0} mods, ${sourcesRegistry?.sources?.length ?? 0} sources, ${localImages?.length ?? 0} local images.`,
  );
}
