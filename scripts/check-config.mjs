// Stops `npm run deploy` / remote migrations before `npm run setup` has created this copy's database.
import { readFileSync } from "node:fs";

const config = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
if (config.includes("REPLACE_BY_NPM_RUN_SETUP")) {
  console.error(
    "\n✖ This copy isn't set up yet. Run first:\n    npm run setup -- --name <your-worker-name>\n  (see README.md)\n"
  );
  process.exit(1);
}
