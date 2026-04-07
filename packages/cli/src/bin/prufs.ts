#!/usr/bin/env node
/**
 * prufs - command-line interface entry point
 */
import { parseArgs, getString } from "../args.js";
import { loadConfigFile, resolveConfig, type CliFlags, type CliEnv } from "../config.js";
import { FileStore } from "../store.js";
import {
  cmdPush,
  cmdPull,
  cmdSync,
  cmdStatus,
  cmdExport,
  USAGE,
  type CommandDeps,
  type CommandOptions,
} from "../commands.js";

const VERSION = "0.1.0";

async function main(): Promise<number> {
  const { command, flags } = parseArgs(process.argv.slice(2));

  if (flags.version || flags.v || command === "version") {
    console.log(`@prufs/cli v${VERSION}`);
    return 0;
  }
  if (flags.help || flags.h || command === "help" || !command) {
    console.log(USAGE);
    return 0;
  }

  const cliFlags: CliFlags = {
    apiKey: getString(flags, "api-key"),
    org: getString(flags, "org"),
    apiUrl: getString(flags, "api-url"),
    store: getString(flags, "store"),
  };

  const cliEnv: CliEnv = {
    PRUFS_API_KEY: process.env.PRUFS_API_KEY,
    PRUFS_ORG: process.env.PRUFS_ORG,
    PRUFS_API_URL: process.env.PRUFS_API_URL,
    PRUFS_STORE: process.env.PRUFS_STORE,
  };

  const needsCloud =
    command === "push" ||
    command === "pull" ||
    command === "sync" ||
    command === "status";

  let deps: CommandDeps;

  if (needsCloud) {
    const file = await loadConfigFile();
    const config = resolveConfig(cliFlags, cliEnv, file);
    const store = new FileStore(config.storePath);
    deps = { config, store };
  } else {
    // export works offline; we still need a store path
    const storePath =
      cliFlags.store ?? cliEnv.PRUFS_STORE ?? `${process.env.HOME ?? ""}/.prufs/store`;
    const store = new FileStore(storePath);
    deps = {
      config: {
        apiKey: "",
        orgSlug: "",
        baseUrl: "",
        storePath,
      },
      store,
    };
  }

  const opts: CommandOptions = {
    branch: getString(flags, "branch"),
    format: (getString(flags, "format") as "json" | "ndjson") ?? "json",
    outPath: getString(flags, "out"),
  };

  switch (command) {
    case "push":
      return cmdPush(deps, opts);
    case "pull":
      return cmdPull(deps, opts);
    case "sync":
      return cmdSync(deps, opts);
    case "status":
      return cmdStatus(deps);
    case "export":
      return cmdExport(deps, opts);
    default:
      console.error(`Unknown command: ${command}\n`);
      console.error(USAGE);
      return 2;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("Error:", err.message ?? err);
    process.exit(1);
  });
