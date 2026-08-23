import { config as loadEnvironmentFile } from "dotenv";
import type { ZodError } from "zod";

import { RelayError } from "../errors/RelayError.js";
import { configurationSchema, type Configuration } from "./configurationSchema.js";

function formatConfigurationIssues(error: ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`)
    .join("; ");
}

export function loadConfiguration(environment: NodeJS.ProcessEnv = process.env): Configuration {
  if (environment === process.env) loadEnvironmentFile({ quiet: true });

  const result = configurationSchema.safeParse(environment);
  if (!result.success) {
    throw new RelayError(
      "CONFIGURATION_INVALID",
      `Configuration is invalid: ${formatConfigurationIssues(result.error)}`,
    );
  }
  return result.data;
}
