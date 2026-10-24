# Agent notes

- To deploy this app to Cloudflare, follow **README.md → "Deploy to Cloudflare"** step by step.
  First-time deploy is `npm run setup -- --name <unique-worker-name>`; never run `wrangler deploy` before setup.
- Never invent, print or commit PIN values (`TECH_PIN`, `ENGINEER_PIN`). The person sets them with `npx wrangler secret put`.
- Database changes go in a new file under `migrations/`; never edit an applied migration.
- After changing code: `npm run typecheck`, test with `npm run dev`, then `npm run deploy`.
