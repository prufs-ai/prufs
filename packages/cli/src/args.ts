/**
 * Minimal argv parser. Handles long flags (--key value and --key=value),
 * boolean flags, and a single positional command.
 *
 * Scope is deliberately tiny. For richer parsing, swap in commander or yargs.
 */

export interface ParsedArgs {
  command: string;
  flags: Record<string, string | boolean>;
  positional: string[];
}

export function parseArgs(argv: string[]): ParsedArgs {
  const args = [...argv];
  let command = "";
  if (args.length > 0 && !args[0]!.startsWith("-")) {
    command = args.shift()!;
  }
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (token === undefined) continue;
    if (token.startsWith("--")) {
      const eq = token.indexOf("=");
      if (eq >= 0) {
        const key = token.slice(2, eq);
        const value = token.slice(eq + 1);
        flags[key] = value;
      } else {
        const key = token.slice(2);
        const next = args[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          flags[key] = next;
          i++;
        } else {
          flags[key] = true;
        }
      }
    } else {
      positional.push(token);
    }
  }

  return { command, flags, positional };
}

export function getString(
  flags: Record<string, string | boolean>,
  key: string
): string | undefined {
  const v = flags[key];
  return typeof v === "string" ? v : undefined;
}

export function getBool(
  flags: Record<string, string | boolean>,
  key: string
): boolean {
  return flags[key] === true || flags[key] === "true";
}
