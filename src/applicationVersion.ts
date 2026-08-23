import { readFileSync } from "node:fs";

import { z } from "zod";

const packageMetadataSchema = z.object({ version: z.string().min(1) });

export function getApplicationVersion(): string {
  const packageUrl = new URL("../package.json", import.meta.url);
  const packageMetadata: unknown = JSON.parse(readFileSync(packageUrl, "utf8"));
  return packageMetadataSchema.parse(packageMetadata).version;
}
