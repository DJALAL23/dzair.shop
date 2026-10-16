/**
 * setup-r2-lifecycle.mjs
 *
 * Adds the bucket's lifecycle rule for review uploads: a photo or voice note a
 * shopper sent but never submitted with a review is deleted after a day, with
 * no code to run. Safe to run again: an existing rule is left as it is.
 *
 * Usage (logged in with wrangler; bucket from the root .env):
 *   npm run r2:lifecycle
 */
import { execFileSync } from "node:child_process";
import { getCloudEnv } from "./cloud-env.mjs";

const RULE = "review-uploads-expire";
const PREFIX = "review-uploads/";
const { bucketName } = getCloudEnv();

const wrangler = (...args) => execFileSync("npx", ["wrangler", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const existing = wrangler("r2", "bucket", "lifecycle", "list", bucketName);
if (existing.includes(RULE)) {
  console.log(`${bucketName}: lifecycle rule "${RULE}" already set.`);
} else {
  wrangler("r2", "bucket", "lifecycle", "add", bucketName, RULE, PREFIX, "--expire-days", "1", "--force");
  console.log(`${bucketName}: review uploads not submitted are now deleted after a day (rule "${RULE}").`);
}
