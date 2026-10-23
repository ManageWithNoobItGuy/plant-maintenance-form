import {
  authConfigured,
  clearCookie,
  clearFailures,
  isLockedOut,
  LOCKOUT_MESSAGE,
  readSession,
  recordFailure,
  roleForPin,
  sessionCookie,
} from "./auth";
import { buildDocx, ROWS_PER_SHEET, type SheetData } from "./docx";
import type { Approval, Env, Inspection, Motor, Status } from "./types";

const STATUSES: Status[] = ["ok", "bad", "fixed"];

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const json = (data: unknown, status = 200, extraHeaders: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extraHeaders },
  });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    try {
      return await route(request, url, env);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error(JSON.stringify({ message: "unhandled error", path: url.pathname, error: String(err) }));
      return json({ error: "เกิดข้อผิดพลาดในระบบ" }, 500);
    }
  },
} satisfies ExportedHandler<Env>;

async function route(req: Request, url: URL, env: Env): Promise<Response> {
  const p = url.pathname.replace(/\/+$/, "").split("/").slice(2).map(decodeURIComponent); // after /api
  const m = req.method;

  // ---- login / session ----
  if (!authConfigured(env)) throw new HttpError(503, "ระบบยังไม่ได้ตั้งค่า PIN (TECH_PIN, ENGINEER_PIN, SESSION_SECRET)");
  if (m === "POST" && p[0] === "login") return login(req, env);
  if (m === "POST" && p[0] === "logout") return json({ ok: true }, 200, { "set-cookie": clearCookie });
  const session = await readSession(req, env);
  if (!session) throw new HttpError(401, "กรุณาเข้าสู่ระบบ");
  if (m === "GET" && p[0] === "me") return json({ role: session.role, exp: session.exp });
  const needEngineer = () => {
    if (session.role !== "engineer") throw new HttpError(403, "ต้องใช้ PIN วิศวกร");
  };

  if (m === "GET" && p[0] === "plants" && p.length === 1) return json(await listPlants(env));
  if (m === "GET" && p[0] === "plants" && p[2] === "motors") return json(await listMotors(env, p[1]));
  if (m === "GET" && p[0] === "inspectors") return json(await listInspectors(env));
  if (m === "GET" && p[0] === "dashboard") return json(await dashboard(env, url.searchParams));
  if (m === "GET" && p[0] === "export") return exportDocx(env, url.searchParams);

  if (p[0] === "motors" && p[1]) {
    const motorId = toId(p[1]);
    if (m === "GET" && p.length === 2) return json(await motorDetail(env, motorId));
    if (m === "POST" && p[2] === "inspections") {
      await getMotor(env, motorId);
      const v = validateInspection(await readJson(req));
      const row = await env.DB.prepare(
        `INSERT INTO inspections (motor_id, inspected_at, cleanliness, cleanliness_note, vibration, vibration_note,
           temp, l1, l2, l3, pressure, level, overall, inspector, remark)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`
      )
        .bind(motorId, ...inspectionValues(v))
        .first<{ id: number }>();
      return json({ id: row!.id }, 201);
    }
    if (p[2] === "sheets" && p[3] && p[4] === "approval") {
      const sheetNo = toId(p[3]);
      needEngineer();
      if (m === "PUT") {
        const body = await readJson(req);
        const engineer = str(body.engineer, 100).trim();
        const approvedOn = str(body.approved_on, 10);
        if (!engineer) throw new HttpError(400, "กรุณากรอกชื่อวิศวกร");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(approvedOn)) throw new HttpError(400, "วันที่ไม่ถูกต้อง");
        await env.DB.prepare(
          `INSERT INTO sheet_approvals (motor_id, sheet_no, engineer, approved_on) VALUES (?,?,?,?)
           ON CONFLICT (motor_id, sheet_no) DO UPDATE SET engineer = excluded.engineer, approved_on = excluded.approved_on`
        )
          .bind(motorId, sheetNo, engineer, approvedOn)
          .run();
        return json({ ok: true });
      }
      if (m === "DELETE") {
        await env.DB.prepare(`DELETE FROM sheet_approvals WHERE motor_id = ? AND sheet_no = ?`).bind(motorId, sheetNo).run();
        return json({ ok: true });
      }
    }
  }

  if (p[0] === "inspections" && p[1]) {
    const id = toId(p[1]);
    if (m === "GET") {
      const ins = await env.DB.prepare(`SELECT * FROM inspections WHERE id = ?`).bind(id).first<Inspection>();
      if (!ins) throw new HttpError(404, "ไม่พบข้อมูลการตรวจ");
      return json({ inspection: ins, motor: await getMotor(env, ins.motor_id) });
    }
    if (m === "PUT") {
      const v = validateInspection(await readJson(req));
      const res = await env.DB.prepare(
        `UPDATE inspections SET inspected_at=?, cleanliness=?, cleanliness_note=?, vibration=?, vibration_note=?,
           temp=?, l1=?, l2=?, l3=?, pressure=?, level=?, overall=?, inspector=?, remark=?, updated_at=datetime('now')
         WHERE id = ?`
      )
        .bind(...inspectionValues(v), id)
        .run();
      if (!res.meta.changes) throw new HttpError(404, "ไม่พบข้อมูลการตรวจ");
      return json({ ok: true });
    }
    if (m === "DELETE") {
      needEngineer();
      await env.DB.prepare(`DELETE FROM inspections WHERE id = ?`).bind(id).run();
      return json({ ok: true });
    }
  }

  throw new HttpError(404, "Not found");
}

// ---------- login ----------

async function login(req: Request, env: Env): Promise<Response> {
  const ip = req.headers.get("cf-connecting-ip") || "local";
  if (await isLockedOut(env, ip)) throw new HttpError(429, LOCKOUT_MESSAGE);
  const body = await readJson(req);
  const pin = str(body.pin, 64).trim();
  const role = pin ? await roleForPin(env, pin) : null;
  if (!role) {
    await recordFailure(env, ip);
    throw new HttpError(401, "PIN ไม่ถูกต้อง");
  }
  // Unlocking an engineer-only action with the technician PIN: refuse, but keep the current session
  if (body.require === "engineer" && role !== "engineer") {
    await recordFailure(env, ip);
    throw new HttpError(403, "PIN นี้ไม่ใช่ PIN วิศวกร");
  }
  await clearFailures(env, ip);
  const { cookie, session } = await sessionCookie(env, role);
  return json({ role: session.role, exp: session.exp }, 200, { "set-cookie": cookie });
}

// ---------- queries ----------

async function listPlants(env: Env) {
  const { results } = await env.DB.prepare(
    `SELECT p.name,
            (SELECT COUNT(*) FROM motors m WHERE m.plant = p.name AND m.active = 1) AS motors,
            (SELECT COUNT(DISTINCT i.motor_id) FROM inspections i JOIN motors m ON m.id = i.motor_id
              WHERE m.plant = p.name AND i.inspected_at >= strftime('%Y-%m-%dT00:00', 'now', '+7 hours', '-6 days')) AS inspected_7d
     FROM plants p ORDER BY p.sort`
  ).all();
  return results;
}

async function listMotors(env: Env, plant: string) {
  const { results } = await env.DB.prepare(
    `SELECT m.*, li.inspected_at AS last_at, li.overall AS last_overall, li.temp AS last_temp,
            (SELECT COUNT(*) FROM inspections c WHERE c.motor_id = m.id) AS inspection_count
     FROM motors m
     LEFT JOIN inspections li ON li.id = (
       SELECT id FROM inspections WHERE motor_id = m.id ORDER BY inspected_at DESC, id DESC LIMIT 1)
     WHERE m.plant = ? AND m.active = 1
     ORDER BY m.sort, m.tag`
  )
    .bind(plant)
    .all();
  return results;
}

async function listInspectors(env: Env) {
  const { results } = await env.DB.prepare(
    `SELECT inspector AS name, MAX(inspected_at) AS last FROM inspections GROUP BY inspector ORDER BY last DESC LIMIT 50`
  ).all<{ name: string }>();
  return results.map((r) => r.name);
}

async function getMotor(env: Env, id: number): Promise<Motor> {
  const motor = await env.DB.prepare(`SELECT * FROM motors WHERE id = ?`).bind(id).first<Motor>();
  if (!motor) throw new HttpError(404, "ไม่พบมอเตอร์");
  return motor;
}

async function inspectionsOf(env: Env, motorIds: number[]): Promise<Map<number, Inspection[]>> {
  const map = new Map<number, Inspection[]>();
  if (!motorIds.length) return map;
  const { results } = await env.DB.prepare(
    `SELECT * FROM inspections WHERE motor_id IN (SELECT value FROM json_each(?)) ORDER BY inspected_at, id`
  )
    .bind(JSON.stringify(motorIds))
    .all<Inspection>();
  for (const r of results) {
    const list = map.get(r.motor_id) ?? [];
    list.push(r);
    map.set(r.motor_id, list);
  }
  return map;
}

async function approvalsOf(env: Env, motorIds: number[]): Promise<Approval[]> {
  if (!motorIds.length) return [];
  const { results } = await env.DB.prepare(
    `SELECT motor_id, sheet_no, engineer, approved_on FROM sheet_approvals WHERE motor_id IN (SELECT value FROM json_each(?))`
  )
    .bind(JSON.stringify(motorIds))
    .all<Approval>();
  return results;
}

async function motorDetail(env: Env, id: number) {
  const motor = await getMotor(env, id);
  const list = (await inspectionsOf(env, [id])).get(id) ?? [];
  const inspections = list.map((ins, idx) => ({
    ...ins,
    no: idx + 1,
    sheet_no: Math.floor(idx / ROWS_PER_SHEET) + 1,
    row_no: (idx % ROWS_PER_SHEET) + 1,
  }));
  const approvals = await approvalsOf(env, [id]);
  return { motor, inspections, approvals, rows_per_sheet: ROWS_PER_SHEET };
}

async function dashboard(env: Env, q: URLSearchParams) {
  const plant = q.get("plant") || null;
  const from = q.get("from") || new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 8) + "01";
  const to = q.get("to") || new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new HttpError(400, "ช่วงวันที่ไม่ถูกต้อง");
  const range = [from + "T00:00", to + "T23:59"];
  const plantCond = plant ? "AND m.plant = ?" : "";
  const plantArgs = plant ? [plant] : [];

  const totals = await env.DB.prepare(
    `SELECT COUNT(*) AS total,
            COUNT(DISTINCT i.motor_id) AS motors_inspected,
            SUM(i.overall = 'ok') AS ok, SUM(i.overall = 'bad') AS bad, SUM(i.overall = 'fixed') AS fixed
     FROM inspections i JOIN motors m ON m.id = i.motor_id
     WHERE i.inspected_at BETWEEN ? AND ? ${plantCond}`
  )
    .bind(...range, ...plantArgs)
    .first();

  const motorCount = await env.DB.prepare(`SELECT COUNT(*) AS n FROM motors m WHERE m.active = 1 ${plantCond}`)
    .bind(...plantArgs)
    .first<{ n: number }>();

  const listSql = (overall: Status) =>
    env.DB.prepare(
      `SELECT i.id, i.inspected_at, i.inspector, i.remark, i.cleanliness, i.vibration, i.temp,
              m.id AS motor_id, m.tag, m.description, m.plant
       FROM inspections i JOIN motors m ON m.id = i.motor_id
       WHERE i.overall = '${overall}' AND i.inspected_at BETWEEN ? AND ? ${plantCond}
       ORDER BY i.inspected_at DESC LIMIT 200`
    ).bind(...range, ...plantArgs);

  // motors whose most recent inspection is still abnormal (not yet fixed)
  const openIssues = env.DB.prepare(
    `SELECT m.id AS motor_id, m.tag, m.description, m.plant, li.inspected_at, li.inspector, li.remark, li.id
     FROM motors m JOIN inspections li ON li.id = (
       SELECT id FROM inspections WHERE motor_id = m.id ORDER BY inspected_at DESC, id DESC LIMIT 1)
     WHERE li.overall = 'bad' AND m.active = 1 ${plantCond}
     ORDER BY li.inspected_at DESC`
  ).bind(...plantArgs);

  const [bad, fixed, open] = await env.DB.batch([listSql("bad"), listSql("fixed"), openIssues]);
  return {
    plant,
    from,
    to,
    motors: motorCount?.n ?? 0,
    totals,
    bad: bad.results,
    fixed: fixed.results,
    open: open.results,
  };
}

// ---------- export ----------

async function exportDocx(env: Env, q: URLSearchParams): Promise<Response> {
  const motorParam = q.get("motor");
  const plant = q.get("plant");
  const which = q.get("sheet") || "latest"; // 'latest' | 'all' | <number>

  let motors: Motor[];
  if (motorParam) motors = [await getMotor(env, toId(motorParam))];
  else if (plant) {
    const { results } = await env.DB.prepare(`SELECT * FROM motors WHERE plant = ? AND active = 1 ORDER BY sort, tag`)
      .bind(plant)
      .all<Motor>();
    motors = results;
    if (!motors.length) throw new HttpError(404, "ไม่พบ Plant");
  } else throw new HttpError(400, "ต้องระบุ plant หรือ motor");

  const ids = motors.map((x) => x.id);
  const [insMap, approvals] = await Promise.all([inspectionsOf(env, ids), approvalsOf(env, ids)]);
  const approvalOf = (motorId: number, sheetNo: number) =>
    approvals.find((a) => a.motor_id === motorId && a.sheet_no === sheetNo) ?? null;

  const sheets: SheetData[] = [];
  for (const motor of motors) {
    const list = insMap.get(motor.id) ?? [];
    const sheetCount = Math.max(1, Math.ceil(list.length / ROWS_PER_SHEET));
    let numbers: number[];
    if (which === "all") numbers = Array.from({ length: sheetCount }, (_, i) => i + 1);
    else if (which === "latest") numbers = [sheetCount];
    else numbers = [toId(which)];
    for (const n of numbers) {
      sheets.push({
        motor,
        rows: list.slice((n - 1) * ROWS_PER_SHEET, n * ROWS_PER_SHEET),
        approval: approvalOf(motor.id, n),
      });
    }
  }

  const label = motorParam ? `${motors[0].plant} ${motors[0].tag}` : plant!;
  const sheetLabel = which === "all" ? "ทุกแผ่น" : which === "latest" ? "" : ` แผ่นที่ ${which}`;
  const title = `Weekly check sheet ${label}${sheetLabel}`.trim();
  const bytes = buildDocx(sheets, title);
  const filename = `checksheet motor ${label}${sheetLabel}.docx`.replace(/[\\/:*?"<>|]/g, "-");
  return new Response(bytes, {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "content-disposition": `attachment; filename="checksheet.docx"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "cache-control": "no-store",
    },
  });
}

// ---------- validation ----------

interface InspectionInput {
  inspected_at: string;
  cleanliness: Status;
  cleanliness_note: string;
  vibration: Status;
  vibration_note: string;
  temp: number | null;
  l1: number | null;
  l2: number | null;
  l3: number | null;
  pressure: number | null;
  level: number | null;
  overall: Status;
  inspector: string;
  remark: string;
}

function validateInspection(b: Record<string, unknown>): InspectionInput {
  const status = (v: unknown, label: string): Status => {
    if (typeof v === "string" && (STATUSES as string[]).includes(v)) return v as Status;
    throw new HttpError(400, `กรุณาเลือกผล "${label}"`);
  };
  const number = (v: unknown, label: string): number | null => {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n) || n < -100 || n > 100000) throw new HttpError(400, `ค่า ${label} ไม่ถูกต้อง`);
    return n;
  };
  const at = str(b.inspected_at, 16);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(at)) throw new HttpError(400, "วันที่ตรวจไม่ถูกต้อง");
  const inspector = str(b.inspector, 100).trim();
  if (!inspector) throw new HttpError(400, "กรุณากรอกชื่อผู้ตรวจ");
  return {
    inspected_at: at,
    cleanliness: status(b.cleanliness, "ความสะอาดมอเตอร์"),
    cleanliness_note: str(b.cleanliness_note, 500).trim(),
    vibration: status(b.vibration, "การสั่นมอเตอร์"),
    vibration_note: str(b.vibration_note, 500).trim(),
    temp: number(b.temp, "อุณหภูมิ"),
    l1: number(b.l1, "L1"),
    l2: number(b.l2, "L2"),
    l3: number(b.l3, "L3"),
    pressure: number(b.pressure, "Pressure"),
    level: number(b.level, "Level"),
    overall: status(b.overall, "สถานะการตรวจเช็ค"),
    inspector,
    remark: str(b.remark, 1000).trim(),
  };
}

function inspectionValues(v: InspectionInput) {
  return [
    v.inspected_at, v.cleanliness, v.cleanliness_note, v.vibration, v.vibration_note,
    v.temp, v.l1, v.l2, v.l3, v.pressure, v.level, v.overall, v.inspector, v.remark,
  ];
}

function str(v: unknown, max: number): string {
  if (v === null || v === undefined) return "";
  return String(v).slice(0, max);
}

function toId(s: string): number {
  const n = Number(s);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, "รหัสไม่ถูกต้อง");
  return n;
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    if (body && typeof body === "object") return body as Record<string, unknown>;
  } catch {}
  throw new HttpError(400, "ข้อมูลไม่ถูกต้อง");
}
