# Motor Weekly Check Sheet (ISO)

Web app ให้ช่างบันทึกผลตรวจมอเตอร์รายสัปดาห์ แล้วดึงข้อมูลออกเป็นฟอร์ม Word ตามแบบที่ขึ้นทะเบียน ISO
(`template/checksheet-motor-original.docx`) — Cloudflare Worker + D1

- Production: https://plant-maintenance-form.homemartmax.workers.dev
- D1 database: `plant-maintenance`

## โครงสร้าง
- `src/index.ts` — API (`/api/*`)
- `src/docx.ts` — เติมข้อมูลลงฟอร์ม Word (1 ตาราง = มอเตอร์ 1 เครื่อง × 30 รายการ)
- `src/template.json` — สร้างจากไฟล์ฟอร์มต้นฉบับด้วย `npm run build:template`
- `public/` — หน้าเว็บ (ไม่มี build step)
- `migrations/` — schema + รายชื่อมอเตอร์ 122 เครื่อง (4 Plant)

## คำสั่ง
```bash
npm run db:migrate:local   # สร้างตารางในฐานข้อมูล local
npm run dev                # เปิดทดสอบที่ http://localhost:8787
npm run db:migrate:remote  # อัปเดตตารางบน Cloudflare
npm run deploy             # deploy ขึ้น Cloudflare
```

## PIN เข้าใช้งาน
- **PIN ช่าง** (`TECH_PIN`) — ดู บันทึก แก้ไขผลตรวจ และดาวน์โหลดฟอร์ม (อยู่ในระบบได้ 30 วัน)
- **PIN วิศวกร** (`ENGINEER_PIN`) — ทำได้ทุกอย่าง + ลบข้อมูล และลงนามแผ่นตรวจ (อยู่ในระบบได้ 12 ชั่วโมง)
- ใส่ PIN ผิด 10 ครั้งภายใน 15 นาที จะถูกล็อก 15 นาที
- เปลี่ยน PIN เมื่อไหร่ ทุกคนที่ใช้ PIN เดิมจะถูกออกจากระบบอัตโนมัติ

ตั้ง / เปลี่ยน PIN (ระบบจะถามค่าเอง):
```bash
npx wrangler secret put TECH_PIN
npx wrangler secret put ENGINEER_PIN
```
`SESSION_SECRET` ตั้งไว้แล้ว (ค่าสุ่ม) — สำหรับทดสอบในเครื่อง ใช้ไฟล์ `.dev.vars`

ถ้าแบบฟอร์ม ISO มีการแก้ไข: แทนที่ไฟล์ใน `template/` แล้วรัน `npm run build:template` และ `npm run deploy`
