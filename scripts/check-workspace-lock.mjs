/**
 * The root lockfile records every workspace as its package.json declares it.
 *
 * A version bumped in a workspace's package.json and never installed leaves
 * the lockfile naming the old one — the SDKs once sat two releases behind it.
 * `npm ci` installs from the lockfile, so the two must agree; `verify:sdks`
 * runs this before any SDK can be released.
 *
 * Usage: node scripts/check-workspace-lock.mjs [path/to/package-lock.json]
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const lockfile = readJson(process.argv[2] ?? path.join(repoRoot, "package-lock.json"));
const workspaces = readJson(path.join(repoRoot, "package.json")).workspaces ?? [];

const problems = [];
for (const workspace of workspaces) {
  const declared = readJson(path.join(repoRoot, workspace, "package.json"));
  const recorded = lockfile.packages?.[workspace];
  if (recorded === undefined) problems.push(`${workspace} is not in the lockfile`);
  // npm leaves the name out of the lockfile when it is the folder's own.
  else if ((recorded.name ?? path.basename(workspace)) !== declared.name) problems.push(`${workspace} is ${declared.name}, the lockfile says ${recorded.name ?? path.basename(workspace)}`);
  else if (recorded.version !== declared.version) problems.push(`${workspace} is ${declared.version}, the lockfile says ${recorded.version}`);
}

if (problems.length > 0) {
  console.error(`\nThe root lockfile is behind the workspaces:\n  ${problems.join("\n  ")}\nRun \`npm install\` at the repository root and commit package-lock.json with the version change.\n`);
  process.exit(1);
}
console.log(`root lockfile records all ${workspaces.length} workspaces at their versions`);
