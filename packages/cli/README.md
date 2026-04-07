# @prufs/cli

Command-line interface for Prufs cloud sync. Five commands, one binary.

## Install

```
npm install -g @prufs/cli
```

Or add to a project:

```
npm install @prufs/cli
npx prufs status
```

## Configuration

The CLI resolves configuration in this order (highest to lowest precedence):

1. Command-line flags (`--api-key`, `--org`, `--api-url`, `--store`)
2. Environment variables (`PRUFS_API_KEY`, `PRUFS_ORG`, `PRUFS_API_URL`, `PRUFS_STORE`)
3. Config file at `~/.prufs/config.json`
4. Built-in defaults (`https://api.prufs.ai` for the API, `~/.prufs/store` for the local store)

Minimum viable config:

```json
{
  "apiKey": "prfs_your_key_here",
  "orgSlug": "cognitionhive"
}
```

## Commands

```
prufs push [--branch <name>]
prufs pull [--branch <name>]
prufs sync [--branch <name>]
prufs status
prufs export [--format json|ndjson] [--out <path>]
```

All of `push`, `pull`, `sync`, and `status` require credentials. `export` works offline against the local store only.

## Exit codes

- `0` - success
- `1` - the command ran but reported rejected commits or errors
- `2` - unknown command

## Architecture

The CLI is a thin shell over `@prufs/sdk-cloudsync`. The `CloudSync` facade owns the HTTP client and the sync engine; the CLI only handles argument parsing, config resolution, and output formatting. Commands accept a `CommandDeps` object so tests can inject a fake `CloudSync` and a fake store without touching the network.

## Tests

40 tests covering argv parsing, config precedence, and all five commands. Run with `npm test`.
