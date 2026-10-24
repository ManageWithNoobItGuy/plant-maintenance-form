#!/usr/bin/env node
// One-command deploy of a NEW copy of this app to your Cloudflare account.
//
//   npm run setup -- --name <worker-name> [--db <d1-name>] [--location apac]
//
// What it does (safe to re-run):
//   1. checks you are logged in to Cloudflare (npx wrangler login)
//   2. refuses to touch a Worker or D1 database that already exists and isn't this copy's
//   3. creates the D1 database and writes its name/id into wrangler.jsonc
//   4. creates the tables + motor list (D1 migrations)
//   5. deploys the Worker
//   6. sets SESSION_SECRET (random). Sets TECH_PIN / ENGINEER_PIN only if they are given
//      as environment variables; otherwise prints the commands for a person to run.

import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const CONFIG = new URL("../wrangler.jsonc", import.meta.url);
const PLACEHOLDER = "REPLACE_BY_NPM_RUN_SETUP";

// ---------- args ----------
const args = process.argv.slice(2);
const arg = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
const name = arg("--name");
const location = arg("--location") || "apac";
if (!name || !/^[a-z0-9][a-z0-9-]{1,52}[a-z0-9]$/.test(name)) {
  fail(
    "Give the new Worker a unique name (lowercase letters, numbers, dashes), e.g.\n" +
      "  npm run setup -- --name acme-motor-check"
  );
}
const dbName = arg("--db") || `${name}-db`;

// ---------- helpers ----------
function fail(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}
function step(msg) {
  console.log(`\n▶ ${msg}`);
}
function wrangler(wArgs, { capture = false, allowFail = false, input } = {}) {
  const res = spawnSync("npx", ["wrangler", ...wArgs], {
    encoding: "utf8",
    stdio: capture || input !== undefined ? ["pipe", "pipe", "pipe"] : "inherit",
    input,
    shell: process.platform === "win32",
  });
  if (res.status !== 0 && !allowFail) {
    if (capture) console.error(res.stdout, res.stderr);
    fail(`wrangler ${wArgs.join(" ")} failed`);
  }
  return res;
}
function json(text) {
  const start = text.search(/[[{]/);
  return JSON.parse(text.slice(start));
}

// ---------- 1. login ----------
step("Checking Cloudflare login");
const who = wrangler(["whoami"], { capture: true, allowFail: true });
if (who.status !== 0 || /not authenticated|You are not logged in/i.test(who.stdout + who.stderr)) {
  fail("Not logged in to Cloudflare. Run:  npx wrangler login   (or set CLOUDFLARE_API_TOKEN), then re-run setup.");
}

// ---------- current config ----------
let config = readFileSync(CONFIG, "utf8");
const current = {
  name: config.match(/"name":\s*"([^"]+)"/)?.[1],
  dbName: config.match(/"database_name":\s*"([^"]+)"/)?.[1],
  dbId: config.match(/"database_id":\s*"([^"]+)"/)?.[1],
};
const alreadySetUp = current.dbId && current.dbId !== PLACEHOLDER;
if (alreadySetUp && (current.name !== name || current.dbName !== dbName)) {
  fail(
    `wrangler.jsonc is already set up for Worker "${current.name}" / database "${current.dbName}".\n` +
      `  Re-run with --name ${current.name}${current.dbName !== `${current.name}-db` ? ` --db ${current.dbName}` : ""} to redeploy it,\n` +
      `  or start from a fresh clone to create another copy.`
  );
}

// ---------- 2. don't touch someone else's Worker / database ----------
step(`Checking that "${name}" is free`);
const workerExists = wrangler(["deployments", "list", "--name", name, "--json"], { capture: true, allowFail: true }).status === 0;
if (workerExists && !alreadySetUp) {
  fail(`A Worker named "${name}" already exists on this account. Pick another --name so you don't overwrite it.`);
}
const dbs = json(wrangler(["d1", "list", "--json"], { capture: true }).stdout);
const existingDb = dbs.find((d) => d.name === dbName);
if (existingDb && !(alreadySetUp && existingDb.uuid === current.dbId)) {
  fail(`A D1 database named "${dbName}" already exists on this account. Pick another --name (or --db).`);
}

// ---------- 3. database + config ----------
let dbId = current.dbId;
if (!alreadySetUp) {
  step(`Creating D1 database "${dbName}" (${location})`);
  wrangler(["d1", "create", dbName, "--location", location], { capture: true });
  dbId = json(wrangler(["d1", "info", dbName, "--json"], { capture: true }).stdout).uuid;
  if (!dbId) fail("Could not read the new database id.");
  config = config
    .replace(/("name":\s*)"[^"]+"/, `$1"${name}"`)
    .replace(/("database_name":\s*)"[^"]+"/, `$1"${dbName}"`)
    .replace(/("database_id":\s*)"[^"]+"/, `$1"${dbId}"`);
  writeFileSync(CONFIG, config);
  console.log(`  wrangler.jsonc → Worker "${name}", database "${dbName}" (${dbId})`);
}

// ---------- 4. tables ----------
step("Creating tables and the motor list");
wrangler(["d1", "migrations", "apply", "DB", "--remote"]);

// ---------- 5. deploy ----------
step("Deploying the Worker");
const deploy = wrangler(["deploy"], { capture: true });
process.stdout.write(deploy.stdout);
const url = (deploy.stdout + deploy.stderr).match(/https:\/\/\S+\.workers\.dev/)?.[0];

// ---------- 6. secrets ----------
step("Setting secrets");
const secretList = wrangler(["secret", "list", "--format", "json"], { capture: true, allowFail: true });
const have = new Set(secretList.status === 0 ? json(secretList.stdout).map((s) => s.name) : []);
const toSet = {};
if (!have.has("SESSION_SECRET")) toSet.SESSION_SECRET = randomBytes(36).toString("base64url");
for (const k of ["TECH_PIN", "ENGINEER_PIN"]) if (process.env[k]) toSet[k] = process.env[k];
if (process.env.TECH_PIN && process.env.TECH_PIN === process.env.ENGINEER_PIN) {
  fail("TECH_PIN and ENGINEER_PIN must be different.");
}
if (Object.keys(toSet).length) {
  const dir = mkdtempSync(join(tmpdir(), "pm-secrets-"));
  const file = join(dir, "secrets.json");
  try {
    writeFileSync(file, JSON.stringify(toSet), { mode: 0o600 });
    wrangler(["secret", "bulk", file], { capture: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log(`  set: ${Object.keys(toSet).join(", ")}`);
}
const missingPins = ["TECH_PIN", "ENGINEER_PIN"].filter((k) => !have.has(k) && !toSet[k]);

console.log("\n✔ Deployed" + (url ? `: ${url}` : ""));
if (missingPins.length) {
  console.log(
    "\n⚠ The site stays locked until these PINs are set. A person should run each command\n" +
      "  and type the PIN when asked (technician and engineer PINs must be different):\n" +
      missingPins.map((k) => `    npx wrangler secret put ${k}`).join("\n")
  );
}
