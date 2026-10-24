# Motor Weekly Check Sheet (ISO)

ระบบให้ช่างบันทึกผลตรวจมอเตอร์รายสัปดาห์ผ่านมือถือ/แท็บเล็ต แล้วดึงข้อมูลออกมาเป็น **ไฟล์ Word ตามแบบฟอร์ม ISO ที่ขึ้นทะเบียน** (Weekly check sheet — 1 หน้าต่อมอเตอร์ 1 เครื่อง, 30 รายการ)
รันบน **Cloudflare Workers + D1** (ใช้ Free plan ได้)

A web app for technicians to record weekly motor inspections and export them into the registered ISO Word form. Runs on Cloudflare Workers + D1.

## ความสามารถ / Features

- เลือก Plant → มอเตอร์ → บันทึกผลตรวจ (มอเตอร์ 122 เครื่อง, 4 Plant: FA, UF, UT 1, UT 2 — ใส่มาให้แล้ว)
- ตรวจ 6 หัวข้อตามฟอร์ม: ความสะอาด, การสั่น (✓ ปกติ / ✕ ผิดปกติ / Ⓧ แก้ไขแล้ว), อุณหภูมิ (เตือนเมื่อเกิน 65 °C), กระแส L1–L3 (เตือนเมื่อเกินพิกัด), Pressure, Level
- แบ่งแผ่นละ 30 รายการ วิศวกรลงนามรายแผ่น
- ดาวน์โหลด Word (.docx) จากไฟล์ฟอร์มต้นฉบับ ทั้งรายเครื่องและทั้ง Plant / พิมพ์หรือบันทึก PDF จากหน้าเว็บ
- Dashboard สรุปผลตามช่วงวันที่
- เข้าระบบด้วย PIN 2 ระดับ
  - **PIN ช่าง** (`TECH_PIN`): ดู บันทึก แก้ไขผลตรวจ ดาวน์โหลดฟอร์ม (อยู่ในระบบ 30 วัน)
  - **PIN วิศวกร** (`ENGINEER_PIN`): ทำได้ทุกอย่าง + ลบข้อมูล และลงนามแผ่นตรวจ (อยู่ในระบบ 12 ชั่วโมง)
  - ใส่ PIN ผิด 10 ครั้งใน 15 นาที ถูกล็อก 15 นาที · เปลี่ยน PIN แล้วทุกคนที่ใช้ PIN เดิมจะถูกออกจากระบบ

---

## Deploy to Cloudflare (instructions for AI agents and people)

> **AI agent:** follow these steps in order. Run commands from the repository root.
> Never invent, choose, print or commit PIN values — the person sets the PINs themselves (step 5).

### Requirements
- Node.js 20 or newer (`node -v`)
- A Cloudflare account (the Free plan is enough)

### 1. Install
```bash
npm install
```

### 2. Log in to Cloudflare
```bash
npx wrangler whoami
```
If it says you are not logged in, the person must run `npx wrangler login` (it opens a browser to approve).
In CI or without a browser, set the `CLOUDFLARE_API_TOKEN` environment variable instead (token permissions: *Workers Scripts: Edit*, *D1: Edit*).

### 3. Choose a unique name
Ask the person for a Worker name, or propose one such as `<company>-motor-check`
(lowercase letters, numbers and dashes). The site URL becomes `https://<name>.<account-subdomain>.workers.dev`.

### 4. Run setup (creates everything)
```bash
npm run setup -- --name <worker-name>
```
This one command:
1. checks the Cloudflare login
2. **refuses** if a Worker named `<worker-name>` or a D1 database named `<worker-name>-db` already exists on the account (so nobody overwrites an existing system — if it refuses, pick another name)
3. creates the D1 database `<worker-name>-db` and writes its name and id into `wrangler.jsonc`
4. creates the tables and loads the motor list (`migrations/`)
5. deploys the Worker and prints its URL
6. sets a random `SESSION_SECRET`

Options: `--db <d1-name>` to name the database yourself, `--location <hint>` for the database region (default `apac`; others: `wnam`, `enam`, `weur`, `eeur`, `oc`).

Setup is safe to re-run with the same `--name`.

### 5. Set the two PINs (the person does this)
The site shows "ยังไม่ได้ตั้งค่า PIN" until both PINs exist. The person runs each command and types the PIN when asked.
The technician and engineer PINs **must be different**.
```bash
npx wrangler secret put TECH_PIN
```
```bash
npx wrangler secret put ENGINEER_PIN
```
(Non-interactive alternative: `TECH_PIN=… ENGINEER_PIN=… npm run setup -- --name <worker-name>` — only when the person provides the values.)

### 6. Check it works
- `curl https://<url>/api/plants` → `{"error":"กรุณาเข้าสู่ระบบ"}` means it is running and locked (correct).
  `ยังไม่ได้ตั้งค่า PIN` means step 5 is not done yet.
- Open the URL, log in with the technician PIN, record one inspection, then download the Word form from the motor page.

### Commit the config
After setup, `wrangler.jsonc` contains this copy's Worker name and database id. Commit it in **your own** repository so later deploys use the same database.

---

## Later updates

| Task | Command |
|------|---------|
| Deploy code changes (also applies new migrations) | `npm run deploy` |
| Change a PIN (logs out everyone using the old PIN) | `npx wrangler secret put TECH_PIN` / `ENGINEER_PIN` |
| View live logs | `npx wrangler tail` |
| Back up the database | `npx wrangler d1 export DB --remote --output backup.sql` |
| Typecheck | `npm run typecheck` |

`npm run deploy` stops with a message if `npm run setup` has not been run yet.

### Change the motor list
Motors live in the `motors` table. Add a new migration file, e.g. `migrations/0004_add_motors.sql`:
```sql
INSERT INTO motors (plant, tag, description, brand, type, kw, volt, amp, rpm, connection, sort)
VALUES ('FA PLANT', 'P-99', 'New pump', 'ABB', 'M2JA132', 7.5, 380, 14.5, 2925, 'DELTA', 27);
-- retire a motor without losing its history:
UPDATE motors SET active = 0 WHERE plant = 'FA PLANT' AND tag = 'P-13';
```
A new plant needs a row in `plants` first: `INSERT INTO plants (name, sort) VALUES ('NEW PLANT', 5);`
Then run `npm run deploy`. Never edit migrations that have already been applied.

### Change the ISO Word form
Replace `template/checksheet-motor-original.docx` (keep the same table layout: 1 table per motor, 30 data rows), then:
```bash
npm run build:template   # needs python3; regenerates src/template.json
npm run deploy
```

---

## Run locally

```bash
cp .dev.vars.example .dev.vars   # test PINs for local use only
npm run dev                      # http://localhost:8787
```
Local data is stored in `.wrangler/` and is separate from the live database.

## Project structure

| Path | What it is |
|------|------------|
| `src/index.ts` | API routes (`/api/*`) and access rules |
| `src/auth.ts` | PIN login, signed session cookie, lockout |
| `src/docx.ts` | Fills the ISO Word form |
| `src/template.json` | Generated from the Word form by `scripts/build_template.py` |
| `public/` | Web pages (plain HTML/CSS/JS, no build step) |
| `migrations/` | Database tables + motor list |
| `scripts/setup.mjs` | First-time deploy (`npm run setup`) |
| `wrangler.jsonc` | Cloudflare config (Worker name, D1 binding `DB`) |

### API overview
All routes need a session cookie except `POST /api/login` (`{ "pin": "…" }`).
`GET /api/plants`, `GET /api/plants/:plant/motors`, `GET /api/motors/:id`, `POST /api/motors/:id/inspections`,
`GET|PUT /api/inspections/:id`, `GET /api/dashboard?plant=&from=&to=`, `GET /api/export?plant=…|motor=…&sheet=latest|all|<n>`.
Engineer only: `DELETE /api/inspections/:id`, `PUT|DELETE /api/motors/:id/sheets/:n/approval`.
