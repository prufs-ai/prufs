import { homedir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";

/**
 * Resolved CLI configuration. Credentials and endpoint come from flags,
 * environment, or the config file, in that order of precedence.
 */
export interface CliConfig {
  apiKey: string;
  orgSlug: string;
  baseUrl: string;
  storePath: string;
}

export interface CliFlags {
  apiKey?: string;
  org?: string;
  apiUrl?: string;
  store?: string;
}

export interface CliEnv {
  PRUFS_API_KEY?: string;
  PRUFS_ORG?: string;
  PRUFS_API_URL?: string;
  PRUFS_STORE?: string;
}

export interface CliConfigFile {
  apiKey?: string;
  orgSlug?: string;
  baseUrl?: string;
  storePath?: string;
}

export const DEFAULT_BASE_URL = "https://api.prufs.ai";
export const DEFAULT_STORE_PATH = join(homedir(), ".prufs", "store");
export const DEFAULT_CONFIG_PATH = join(homedir(), ".prufs", "config.json");

/**
 * Load the config file if present. Returns an empty object when the file
 * does not exist, so callers can treat missing files as "no overrides".
 */
export async function loadConfigFile(
  path: string = DEFAULT_CONFIG_PATH
): Promise<CliConfigFile> {
  if (!existsSync(path)) {
    return {};
  }
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return parsed as CliConfigFile;
    }
    return {};
  } catch (err) {
    throw new Error(
      `Failed to read config file at ${path}: ${(err as Error).message}`
    );
  }
}

/**
 * Resolve the final config by merging flags, environment, and file.
 * Precedence (highest to lowest): flags, env, file, defaults.
 */
export function resolveConfig(
  flags: CliFlags,
  env: CliEnv,
  file: CliConfigFile
): CliConfig {
  const apiKey = flags.apiKey ?? env.PRUFS_API_KEY ?? file.apiKey ?? "";
  const orgSlug = flags.org ?? env.PRUFS_ORG ?? file.orgSlug ?? "";
  const baseUrl =
    flags.apiUrl ?? env.PRUFS_API_URL ?? file.baseUrl ?? DEFAULT_BASE_URL;
  const storePath =
    flags.store ?? env.PRUFS_STORE ?? file.storePath ?? DEFAULT_STORE_PATH;

  if (!apiKey) {
    throw new Error(
      "Missing API key. Set --api-key, PRUFS_API_KEY, or apiKey in " +
        DEFAULT_CONFIG_PATH
    );
  }
  if (!orgSlug) {
    throw new Error(
      "Missing organization slug. Set --org, PRUFS_ORG, or orgSlug in " +
        DEFAULT_CONFIG_PATH
    );
  }

  return { apiKey, orgSlug, baseUrl, storePath };
}
