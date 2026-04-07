import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveConfig, DEFAULT_BASE_URL, DEFAULT_STORE_PATH } from "./config.js";

test("resolveConfig - precedence", async (t) => {
  await t.test("flags beat env beat file", () => {
    const c = resolveConfig(
      { apiKey: "fromFlag", org: "o" },
      { PRUFS_API_KEY: "fromEnv", PRUFS_ORG: "o" },
      { apiKey: "fromFile", orgSlug: "o" }
    );
    assert.equal(c.apiKey, "fromFlag");
  });

  await t.test("env beats file when flag is missing", () => {
    const c = resolveConfig(
      { org: "o" },
      { PRUFS_API_KEY: "fromEnv", PRUFS_ORG: "o" },
      { apiKey: "fromFile", orgSlug: "o" }
    );
    assert.equal(c.apiKey, "fromEnv");
  });

  await t.test("file is used when no flags or env", () => {
    const c = resolveConfig(
      {},
      {},
      { apiKey: "fromFile", orgSlug: "fromFile" }
    );
    assert.equal(c.apiKey, "fromFile");
    assert.equal(c.orgSlug, "fromFile");
  });

  await t.test("uses default baseUrl when unset", () => {
    const c = resolveConfig(
      { apiKey: "k", org: "o" },
      {},
      {}
    );
    assert.equal(c.baseUrl, DEFAULT_BASE_URL);
  });

  await t.test("uses default storePath when unset", () => {
    const c = resolveConfig(
      { apiKey: "k", org: "o" },
      {},
      {}
    );
    assert.equal(c.storePath, DEFAULT_STORE_PATH);
  });

  await t.test("throws when apiKey is missing", () => {
    assert.throws(
      () => resolveConfig({}, {}, {}),
      /Missing API key/
    );
  });

  await t.test("throws when orgSlug is missing", () => {
    assert.throws(
      () => resolveConfig({ apiKey: "k" }, {}, {}),
      /Missing organization slug/
    );
  });
});
