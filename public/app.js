// Motor weekly check sheet — single page app (hash routing, no build step)

const $app = document.getElementById("app");
const $title = document.getElementById("title");
const $eyebrow = document.getElementById("eyebrow");
const $actions = document.getElementById("actions");
const $back = document.getElementById("back");
const $dialog = document.getElementById("dialog");

const STATUS = {
  ok: { sym: "✓", form: "√", label: "ปกติ", long: "ไม่มีสิ่งผิดปกติ" },
  bad: { sym: "✕", form: "X", label: "ผิดปกติ", long: "มีสิ่งผิดปกติ" },
  fixed: { sym: "Ⓧ", form: "Ⓧ", label: "แก้ไขแล้ว", long: "มีสิ่งผิดปกติแก้ไขแล้ว" },
};
const ROWS_PER_SHEET = 30;

// ---------- helpers ----------
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const icon = (path) => `<svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;
const ICONS = {
  chev: icon('<path d="M9 5l7 7-7 7"/>'),
  plus: icon('<path d="M12 5v14M5 12h14"/>'),
  search: icon('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>'),
  chart: icon('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  doc: icon('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>'),
  download: icon('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'),
  print: icon('<path d="M7 9V3h10v6M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2"/><path d="M7 14h10v7H7z"/>'),
  factory: icon('<path d="M3 21V10l6 4V10l6 4V6l6 3v12z"/><path d="M7 17h2M12 17h2M17 17h2"/>'),
  motor: icon('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1L7 17M17 7l2.1-2.1"/>'),
  lock: icon('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
  sign: icon('<path d="M3 17c3-1 4-6 6-6s1 5 3 5 3-3 4-3 2 2 5 2"/><path d="M3 21h18"/>'),
};

function pad(n) { return String(n).padStart(2, "0"); }
function nowLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function today() { return nowLocal().slice(0, 10); }
function fmtDate(iso, withTime = false) {
  if (!iso) return "-";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  let s = `${d}/${m}/${y}`;
  if (withTime && iso.length >= 16) s += ` ${iso.slice(11, 16)} น.`;
  return s;
}
function daysSince(iso) {
  if (!iso) return Infinity;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}
const specVal = (v, unit = "") => (v ? `${v}${unit ? " " + unit : ""}` : "-");
const numText = (v) => (v === null || v === undefined || v === "" ? "" : String(v));

// Bumped on every navigation so a slow response from the previous page can't overwrite the new one
let navToken = 0;
class StaleView extends Error {}

// Logged-in role: "tech" | "engineer" | null (not logged in yet / unknown)
let role = null;

async function api(path, opts = {}, retried = false) {
  const token = navToken;
  const res = await fetch(`/api${path}`, {
    ...opts,
    headers: opts.body ? { "content-type": "application/json" } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== "/login") {
    role = null;
    showLogin();
    throw new StaleView();
  }
  // engineer-only action attempted with a technician session: ask for the engineer PIN, then retry once
  if (res.status === 403 && path !== "/login" && !retried) {
    if (await engineerPrompt()) return api(path, opts, true);
    throw new Error("ต้องใช้ PIN วิศวกร");
  }
  if (token !== navToken && (!opts.method || opts.method === "GET")) throw new StaleView();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ---------- login ----------
const ROLE_LABEL = { tech: "ช่าง", engineer: "วิศวกร" };
const $account = document.getElementById("account");

function paintAccount() {
  $account.hidden = !role;
  if (role) {
    $account.innerHTML = `<span class="role-chip ${role}">${ROLE_LABEL[role]}</span>`;
    $account.title = `เข้าสู่ระบบเป็น${ROLE_LABEL[role]}`;
  }
}

function showLogin() {
  navToken++;
  paintAccount();
  setHeader({ title: "เข้าสู่ระบบ", eyebrow: "Weekly check sheet" });
  $app.innerHTML = `<form class="card login" id="loginForm" autocomplete="off">
      <div class="tile-icon" style="margin:0 auto">${ICONS.lock}</div>
      <h2>ใส่ PIN เพื่อเข้าใช้งาน</h2>
      <p class="muted">ช่างใช้ PIN ช่าง · วิศวกรใช้ PIN วิศวกร</p>
      <input class="input pin" id="pin" type="password" inputmode="numeric" autocomplete="current-password" aria-label="PIN" required autofocus>
      <div id="loginError" class="error-box" hidden></div>
      <button class="btn primary" id="loginBtn">เข้าสู่ระบบ</button>
    </form>`;
  const form = document.getElementById("loginForm");
  document.getElementById("pin").focus();
  form.onsubmit = async (e) => {
    e.preventDefault();
    const $err = document.getElementById("loginError");
    const btn = document.getElementById("loginBtn");
    btn.disabled = true;
    try {
      const r = await api("/login", { method: "POST", body: { pin: form.pin.value } });
      role = r.role;
      paintAccount();
      toast(`เข้าสู่ระบบเป็น${ROLE_LABEL[role]}แล้ว`);
      render();
    } catch (err) {
      $err.textContent = err.message;
      $err.hidden = false;
      form.pin.value = "";
      form.pin.focus();
      btn.disabled = false;
    }
  };
}

/** Ask for the engineer PIN. Resolves true once the session is an engineer session. */
function engineerPrompt() {
  return new Promise((resolve) => {
    $dialog.innerHTML = `<form class="dlg" id="engForm" autocomplete="off">
      <h2>ต้องใช้ PIN วิศวกร</h2>
      <p class="muted" style="margin:0">การลบข้อมูลและการลงนามแผ่นตรวจ ทำได้เฉพาะวิศวกร</p>
      <input class="input pin" id="engPin" type="password" inputmode="numeric" aria-label="PIN วิศวกร" required>
      <div id="engError" class="error-box" hidden></div>
      <div class="btn-row"><button type="button" class="btn" id="engCancel">ยกเลิก</button><button class="btn primary">ยืนยัน</button></div></form>`;
    let ok = false;
    $dialog.onclose = () => resolve(ok);
    document.getElementById("engCancel").onclick = () => $dialog.close();
    document.getElementById("engForm").onsubmit = async (e) => {
      e.preventDefault();
      const input = document.getElementById("engPin");
      try {
        const r = await api("/login", { method: "POST", body: { pin: input.value, require: "engineer" } });
        role = r.role;
        paintAccount();
        ok = true;
        $dialog.close();
      } catch (err) {
        const $e = document.getElementById("engError");
        $e.textContent = err.message;
        $e.hidden = false;
        input.value = "";
        input.focus();
      }
    };
    $dialog.showModal();
    document.getElementById("engPin").focus();
  });
}

async function ensureEngineer() {
  return role === "engineer" || (await engineerPrompt());
}

$account.onclick = () => {
  $dialog.innerHTML = `<form method="dialog" class="dlg">
    <h2>เข้าสู่ระบบเป็น${ROLE_LABEL[role]}</h2>
    <p class="muted" style="margin:0">${role === "engineer" ? "วิศวกรลบข้อมูลและลงนามแผ่นตรวจได้" : "ช่างบันทึกและแก้ไขผลตรวจได้ การลบและลงนามต้องใช้ PIN วิศวกร"}</p>
    <div class="btn-row">
      ${role === "tech" ? `<button class="btn" value="eng">เข้าสู่ระบบวิศวกร</button>` : ""}
      <button class="btn danger" value="logout">ออกจากระบบ</button>
      <button class="btn" value="close">ปิด</button></div></form>`;
  $dialog.onclose = async () => {
    if ($dialog.returnValue === "logout") {
      await fetch("/api/logout", { method: "POST" });
      role = null;
      showLogin();
    } else if ($dialog.returnValue === "eng") {
      if (await engineerPrompt()) toast("เข้าสู่ระบบเป็นวิศวกรแล้ว");
    }
  };
  $dialog.showModal();
};

// Word downloads are plain links; check the session first so an expired login shows the PIN screen
document.addEventListener("click", async (e) => {
  const a = e.target.closest?.('a[href^="/api/export"]');
  if (!a) return;
  e.preventDefault();
  try {
    await api("/me");
    location.href = a.getAttribute("href");
  } catch {}
});

let toastTimer;
function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
}

function storeGet(k, d = "") { try { return localStorage.getItem(k) ?? d; } catch { return d; } }
function storeSet(k, v) { try { localStorage.setItem(k, v); } catch {} }

function setHeader({ title, eyebrow = "Weekly check sheet", back = null, actions = "" }) {
  $title.textContent = title;
  $eyebrow.textContent = eyebrow;
  document.title = `${title} · Motor Check Sheet`;
  $back.hidden = !back;
  $back.onclick = () => (back === "history" ? history.back() : (location.hash = back));
  $actions.innerHTML = actions;
}

function confirmDialog(message, okLabel = "ยืนยัน", danger = false) {
  return new Promise((resolve) => {
    $dialog.innerHTML = `<form method="dialog" class="dlg"><h2>${esc(message)}</h2>
      <div class="btn-row"><button class="btn" value="no">ยกเลิก</button>
      <button class="btn ${danger ? "danger" : "primary"}" value="yes">${esc(okLabel)}</button></div></form>`;
    $dialog.onclose = () => resolve($dialog.returnValue === "yes");
    $dialog.showModal();
  });
}

function statusPill(s) {
  if (!s) return `<span class="pill none">ยังไม่มีข้อมูล</span>`;
  return `<span class="pill ${s}">${STATUS[s].sym} ${STATUS[s].label}</span>`;
}

// thresholds shown to the technician while typing
function tempLevel(v) {
  if (v === null || v === "" || Number.isNaN(+v)) return null;
  v = +v;
  if (v > 65) return { cls: "danger", text: "ร้อนจัด · เกินเกณฑ์ 65 °C" };
  if (v >= 60) return { cls: "warn", text: "ร้อน · ใกล้เกณฑ์ 65 °C" };
  if (v >= 50) return { cls: "caution", text: "เริ่มร้อน" };
  return { cls: "ok", text: "ปกติ" };
}
function currentLevel(v, rated) {
  if (v === null || v === "" || Number.isNaN(+v) || !rated) return null;
  const pct = Math.round((+v / rated) * 100);
  if (pct > 100) return { cls: "danger", text: `เกินพิกัด ${pct}%` };
  if (pct >= 90) return { cls: "warn", text: `ใกล้พิกัด ${pct}%` };
  return { cls: "ok", text: `${pct}% ของพิกัด` };
}

// ---------- router ----------
const routes = [
  [/^#?\/?$/, viewPlants],
  [/^#\/plant\/([^/?]+)$/, (m) => viewMotors(decodeURIComponent(m[1]))],
  [/^#\/motor\/(\d+)$/, (m) => viewMotor(+m[1])],
  [/^#\/motor\/(\d+)\/new$/, (m) => viewForm({ motorId: +m[1] })],
  [/^#\/inspection\/(\d+)$/, (m) => viewForm({ inspectionId: +m[1] })],
  [/^#\/sheet\/(\d+)\/(\d+|all)$/, (m) => viewSheet(+m[1], m[2])],
  [/^#\/dashboard(?:\?(.*))?$/, (m) => viewDashboard(new URLSearchParams(m[1] || ""))],
];

async function render() {
  const hash = location.hash || "#/";
  for (const [re, fn] of routes) {
    const m = hash.match(re);
    if (m) {
      navToken++;
      $app.innerHTML = `<div class="loading">กำลังโหลด…</div>`;
      try {
        if (!role) {
          role = (await api("/me")).role;
          paintAccount();
        }
        await fn(m);
      } catch (err) {
        if (err instanceof StaleView) return;
        $app.innerHTML = `<div class="empty">โหลดข้อมูลไม่สำเร็จ<br><span class="muted">${esc(err.message)}</span><br><br>
          <button class="btn" onclick="location.reload()">ลองใหม่</button></div>`;
      }
      window.scrollTo(0, 0);
      return;
    }
  }
  location.hash = "#/";
}
window.addEventListener("hashchange", render);
render();

// ---------- views ----------
async function viewPlants() {
  setHeader({
    title: "เลือก Plant",
    actions: `<a class="icon-btn" href="#/dashboard" aria-label="Dashboard สรุปผล" title="Dashboard สรุปผล">${ICONS.chart}</a>`,
  });
  const plants = await api("/plants");
  $app.innerHTML = `<div class="list">${plants
    .map((p) => {
      const pct = p.motors ? Math.round((p.inspected_7d / p.motors) * 100) : 0;
      return `<a class="row-link" href="#/plant/${encodeURIComponent(p.name)}">
        <div class="tile-icon">${ICONS.factory}</div>
        <div class="row-main"><div class="row-title">${esc(p.name)}</div>
          <div class="row-sub">${p.motors} เครื่อง · ตรวจแล้ว 7 วันล่าสุด ${p.inspected_7d}/${p.motors}</div>
          <div class="progress" aria-hidden="true"><span style="width:${pct}%"></span></div></div>
        <span class="chev">${ICONS.chev}</span></a>`;
    })
    .join("")}</div>`;
}

async function viewMotors(plant) {
  setHeader({
    title: plant,
    eyebrow: "รายการมอเตอร์",
    back: "#/",
    actions: `<a class="icon-btn" href="#/dashboard?plant=${encodeURIComponent(plant)}" aria-label="Dashboard" title="Dashboard">${ICONS.chart}</a>
      <button class="icon-btn" id="exportPlant" aria-label="ดาวน์โหลดฟอร์ม Word" title="ดาวน์โหลดฟอร์ม Word">${ICONS.download}</button>`,
  });
  const motors = await api(`/plants/${encodeURIComponent(plant)}/motors`);
  document.getElementById("exportPlant").onclick = () => exportDialog(plant);

  const filterKey = "motorFilter";
  let filter = storeGet(filterKey, "all");
  $app.innerHTML = `
    <div class="search">${ICONS.search}<input id="q" type="search" placeholder="ค้นหา Tag No. หรือ Description…" autocomplete="off" aria-label="ค้นหามอเตอร์"></div>
    <div class="filters" role="group" aria-label="กรองรายการ">
      <button class="chip" data-f="all">ทั้งหมด</button>
      <button class="chip" data-f="due">ยังไม่ตรวจสัปดาห์นี้</button>
      <button class="chip" data-f="bad">ผิดปกติล่าสุด</button>
    </div>
    <div class="list" id="motorList"></div>`;
  const $q = document.getElementById("q");
  const draw = () => {
    const q = $q.value.trim().toLowerCase();
    const list = motors.filter((m) => {
      if (q && !`${m.tag} ${m.description} ${m.brand}`.toLowerCase().includes(q)) return false;
      if (filter === "due") return daysSince(m.last_at) >= 7;
      if (filter === "bad") return m.last_overall === "bad";
      return true;
    });
    document.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.f === filter)));
    document.getElementById("motorList").innerHTML = list.length
      ? list
          .map((m) => {
            const due = daysSince(m.last_at) >= 7;
            return `<a class="row-link" href="#/motor/${m.id}">
            <span class="dot ${m.last_overall || "none"}" aria-hidden="true"></span>
            <div class="row-main"><div class="row-title">${esc(m.tag)}</div>
              <div class="row-sub">${esc(m.description)} · ${esc(m.brand)} · ${specVal(m.kw, "kW")}</div></div>
            <div class="row-meta">${m.last_at ? `ตรวจล่าสุด<br><span style="color:${due ? "var(--warn)" : "inherit"}">${fmtDate(m.last_at)}</span>` : `<span style="color:var(--warn)">ยังไม่เคยตรวจ</span>`}</div>
            <span class="chev">${ICONS.chev}</span></a>`;
          })
          .join("")
      : `<div class="empty">ไม่พบมอเตอร์ที่ตรงกับเงื่อนไข</div>`;
  };
  $q.oninput = draw;
  document.querySelectorAll(".chip").forEach((c) => (c.onclick = () => { filter = c.dataset.f; storeSet(filterKey, filter); draw(); }));
  draw();
}

function exportDialog(plant) {
  $dialog.innerHTML = `<form method="dialog" class="dlg">
    <h2>ดาวน์โหลดฟอร์ม Word · ${esc(plant)}</h2>
    <p class="muted" style="margin:0">ไฟล์ .docx ตามแบบฟอร์ม ISO ที่ขึ้นทะเบียน 1 หน้าต่อมอเตอร์ 1 แผ่น (30 รายการ)</p>
    <label class="row-link" style="cursor:pointer"><input type="radio" name="w" value="latest" checked> <div class="row-main"><b>แผ่นล่าสุดของทุกเครื่อง</b><div class="row-sub">ใช้ส่งเอกสารประจำรอบ</div></div></label>
    <label class="row-link" style="cursor:pointer"><input type="radio" name="w" value="all"> <div class="row-main"><b>ทุกแผ่นของทุกเครื่อง</b><div class="row-sub">รวมประวัติทั้งหมด</div></div></label>
    <div class="btn-row"><button class="btn" value="cancel">ยกเลิก</button><button class="btn primary" value="go">${ICONS.download} ดาวน์โหลด</button></div>
  </form>`;
  $dialog.onclose = () => {
    if ($dialog.returnValue !== "go") return;
    const w = $dialog.querySelector("input[name=w]:checked").value;
    location.href = `/api/export?plant=${encodeURIComponent(plant)}&sheet=${w}`;
  };
  $dialog.showModal();
}

async function viewMotor(id) {
  const data = await api(`/motors/${id}`);
  const { motor, inspections, approvals } = data;
  setHeader({ title: motor.tag, eyebrow: motor.plant, back: `#/plant/${encodeURIComponent(motor.plant)}` });

  const sheetCount = Math.max(1, Math.ceil(inspections.length / ROWS_PER_SHEET));
  const sheets = [];
  for (let n = sheetCount; n >= 1; n--) {
    sheets.push({ n, rows: inspections.filter((i) => i.sheet_no === n).reverse(), approval: approvals.find((a) => a.sheet_no === n) });
  }

  $app.innerHTML = `
    <section class="card spec">
      <div><h2>${esc(motor.description || "-")}</h2><div class="muted">${esc(motor.brand)} · ${esc(motor.type)}</div></div>
      <div class="spec-grid">
        <div>Power<b>${specVal(motor.kw, "kW")}</b></div><div>Voltage<b>${specVal(motor.volt, "V")}</b></div>
        <div>Current<b>${specVal(motor.amp, "A")}</b></div><div>Speed<b>${specVal(motor.rpm, "RPM")}</b></div>
        <div>Connection<b>${esc(motor.connection || "-")}</b></div><div>ตรวจทั้งหมด<b>${inspections.length} ครั้ง</b></div>
      </div>
      <div class="btn-row">
        <a class="btn" href="#/sheet/${id}/${sheetCount}">${ICONS.doc} ดูฟอร์ม / พิมพ์</a>
        <a class="btn" href="/api/export?motor=${id}&sheet=${sheetCount}">${ICONS.download} Word แผ่นล่าสุด</a>
        ${sheetCount > 1 ? `<a class="btn" href="/api/export?motor=${id}&sheet=all">${ICONS.download} Word ทุกแผ่น</a>` : ""}
      </div>
    </section>
    <div class="section-title">ประวัติการตรวจเช็ค</div>
    ${inspections.length === 0 ? `<div class="card empty">ยังไม่มีข้อมูลการตรวจ กด “บันทึกผลตรวจ” เพื่อเริ่ม</div>` : ""}
    ${inspections.length ? sheets.map((s) => sheetCard(motor, s)).join("") : ""}
    <button class="fab" id="add">${ICONS.plus} บันทึกผลตรวจ</button>`;

  document.getElementById("add").onclick = () => (location.hash = `#/motor/${id}/new`);
  $app.querySelectorAll("[data-sign]").forEach((b) => (b.onclick = async () => {
    if (!(await ensureEngineer())) return;
    signDialog(motor, +b.dataset.sign, approvals.find((a) => a.sheet_no === +b.dataset.sign));
  }));
}

function sheetCard(motor, s) {
  const full = s.rows.length >= ROWS_PER_SHEET;
  const sign = s.approval
    ? `<span class="sheet-sign">${ICONS.sign.replace("<svg", '<svg style="width:16px;height:16px;vertical-align:-3px"')} วิศวกร: <b>${esc(s.approval.engineer)}</b> · ${fmtDate(s.approval.approved_on)}</span>`
    : `<span class="sheet-sign muted">ยังไม่มีวิศวกรลงนาม</span>`;
  return `<section class="card" style="margin-bottom:12px">
    <div class="sheet-head">
      <div><h3>แผ่นที่ ${s.n} <span class="muted" style="font-weight:400">· ${s.rows.length}/${ROWS_PER_SHEET} รายการ${full ? " (เต็ม)" : ""}</span></h3>${sign}</div>
      <div class="btn-row">
        <button class="btn small" data-sign="${s.n}">${ICONS.sign} ${s.approval ? "แก้ไขการลงนาม" : "วิศวกรลงนาม"}</button>
        <a class="btn small" href="#/sheet/${motor.id}/${s.n}">${ICONS.doc} ฟอร์ม</a>
      </div>
    </div>
    ${s.rows
      .map((i) => {
        const t = tempLevel(i.temp);
        const amps = [i.l1, i.l2, i.l3].filter((v) => v !== null);
        return `<a class="hist" href="#/inspection/${i.id}">
          <div class="hist-no">${i.row_no}</div>
          <div class="hist-body">
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><strong>${fmtDate(i.inspected_at, true)}</strong>${statusPill(i.overall)}</div>
            <div>ผู้ตรวจ: ${esc(i.inspector)}</div>
            <div class="readings">
              <span>ความสะอาด ${STATUS[i.cleanliness].form}</span><span>การสั่น ${STATUS[i.vibration].form}</span>
              ${i.temp !== null ? `<span style="color:${t && t.cls !== "ok" ? "var(--warn)" : "inherit"}">${i.temp} °C${t && t.cls !== "ok" ? ` (${t.text.split(" ·")[0]})` : ""}</span>` : ""}
              ${amps.length ? `<span>${amps.join(" / ")} A</span>` : ""}
              ${i.pressure !== null ? `<span>${i.pressure} barg</span>` : ""}
              ${i.level !== null ? `<span>${i.level} %</span>` : ""}
            </div>
            ${i.remark ? `<div class="muted">${esc(i.remark)}</div>` : ""}
          </div>
          <span class="chev">${ICONS.chev}</span></a>`;
      })
      .join("")}
  </section>`;
}

function signDialog(motor, sheetNo, existing) {
  $dialog.innerHTML = `<form method="dialog" class="dlg" id="signForm">
    <h2>วิศวกรลงนาม · ${esc(motor.tag)} แผ่นที่ ${sheetNo}</h2>
    <div class="field"><label for="engName">ชื่อวิศวกร</label><input class="input" id="engName" required value="${esc(existing?.engineer || storeGet("engineer"))}"></div>
    <div class="field"><label for="engDate">วันที่</label><input class="input" id="engDate" type="date" required value="${existing?.approved_on || today()}"></div>
    <div class="btn-row">${existing ? `<button class="btn danger" value="remove" formnovalidate>ยกเลิกการลงนาม</button>` : ""}
      <button class="btn" value="cancel" formnovalidate>ปิด</button><button class="btn primary" value="save">บันทึก</button></div></form>`;
  $dialog.onclose = async () => {
    try {
      if ($dialog.returnValue === "save") {
        const engineer = document.getElementById("engName").value.trim();
        storeSet("engineer", engineer);
        await api(`/motors/${motor.id}/sheets/${sheetNo}/approval`, {
          method: "PUT",
          body: { engineer, approved_on: document.getElementById("engDate").value },
        });
        toast("บันทึกการลงนามแล้ว");
        render();
      } else if ($dialog.returnValue === "remove") {
        await api(`/motors/${motor.id}/sheets/${sheetNo}/approval`, { method: "DELETE" });
        toast("ยกเลิกการลงนามแล้ว");
        render();
      }
    } catch (err) {
      toast(err.message);
    }
  };
  $dialog.showModal();
}

// ---------- inspection form ----------
async function viewForm({ motorId, inspectionId }) {
  let motor, ins;
  if (inspectionId) {
    ({ motor, inspection: ins } = await api(`/inspections/${inspectionId}`));
  } else {
    ({ motor } = await api(`/motors/${motorId}`));
  }
  const editing = Boolean(ins);
  setHeader({
    title: `${editing ? "แก้ไขผลตรวจ" : "บันทึกผลตรวจ"} · ${motor.tag}`,
    eyebrow: motor.plant,
    back: `#/motor/${motor.id}`,
  });
  const v = ins || {
    inspected_at: nowLocal(), cleanliness: "ok", vibration: "ok", overall: "ok",
    cleanliness_note: "", vibration_note: "", temp: null, l1: null, l2: null, l3: null,
    pressure: null, level: null, inspector: storeGet("inspector"), remark: "",
  };
  const inspectors = await api("/inspectors").catch(() => []);

  const seg = (name, val) => `<div class="seg" role="group" aria-label="${name}">
    ${["ok", "bad", "fixed"].map((s) => `<button type="button" class="${s}" data-name="${name}" data-val="${s}" aria-pressed="${val === s}">
      <span class="sym">${STATUS[s].sym}</span><span>${STATUS[s].label}</span></button>`).join("")}</div>`;
  const numField = (id, label, val, extra = "") => `<div class="field"><label for="${id}">${label}</label>
    <input class="input num" id="${id}" name="${id}" inputmode="decimal" autocomplete="off" value="${esc(numText(val))}" ${extra}>
    <div class="hint" id="${id}-hint"></div></div>`;

  $app.innerHTML = `<form class="form" id="f" novalidate>
    <section class="card panel">
      <div class="field"><label for="inspected_at">วันที่และเวลาที่ตรวจ</label>
        <input class="input" type="datetime-local" id="inspected_at" name="inspected_at" required value="${esc(v.inspected_at)}"></div>
    </section>
    <section class="card panel">
      <h2>รายการตรวจเช็คเบื้องต้น</h2>
      <div class="check-item"><span class="label">1. ตรวจเช็คความสะอาดมอเตอร์</span>${seg("cleanliness", v.cleanliness)}
        <input class="input" name="cleanliness_note" placeholder="รายละเอียดเพิ่มเติม (ถ้ามี)" value="${esc(v.cleanliness_note)}"></div>
      <div class="check-item"><span class="label">2. ตรวจวัดการสั่นมอเตอร์</span>${seg("vibration", v.vibration)}
        <input class="input" name="vibration_note" placeholder="รายละเอียดเพิ่มเติม (ถ้ามี)" value="${esc(v.vibration_note)}"></div>
    </section>
    <section class="card panel">
      <h2>อุณหภูมิ กระแสไฟฟ้า และพารามิเตอร์</h2>
      ${numField("temp", "3. อุณหภูมิมอเตอร์ (°C) · ไม่เกิน 65 °C", v.temp)}
      <div class="field"><span class="label">4. กระแสไฟฟ้า (A)${motor.amp ? ` · พิกัด ${motor.amp} A` : ""}</span>
        <div class="grid-3">${numField("l1", "L1", v.l1)}${numField("l2", "L2", v.l2)}${numField("l3", "L3", v.l3)}</div></div>
      <div class="grid-2 stack-sm" style="margin-top:12px">${numField("pressure", "5. Pressure (barg)", v.pressure)}${numField("level", "6. Level (%)", v.level)}</div>
    </section>
    <section class="card panel">
      <h2>สรุปการตรวจเช็ค</h2>
      <div class="field"><span class="label">สถานะการตรวจเช็ค</span>${seg("overall", v.overall)}
        <div class="hint muted" id="overall-hint"></div></div>
      <div class="field"><label for="inspector">ผู้ตรวจเช็ค *</label>
        <input class="input" id="inspector" name="inspector" list="inspectorList" required autocomplete="name" value="${esc(v.inspector)}">
        <datalist id="inspectorList">${inspectors.map((n) => `<option value="${esc(n)}">`).join("")}</datalist></div>
      <div class="field"><label for="remark">หมายเหตุ</label>
        <textarea class="input" id="remark" name="remark" placeholder="รายละเอียดเพิ่มเติมอื่น ๆ (ถ้ามี)">${esc(v.remark)}</textarea></div>
    </section>
    <div id="formError" class="error-box" hidden></div>
    <div class="form-actions">
      ${editing ? `<button type="button" class="btn danger" id="del">ลบรายการนี้</button>` : ""}
      <button class="btn primary" id="save">${editing ? "บันทึกการแก้ไข" : "บันทึกข้อมูล"}</button>
    </div>
  </form>`;

  const form = document.getElementById("f");
  const state = { cleanliness: v.cleanliness, vibration: v.vibration, overall: v.overall };
  let overallTouched = editing;

  const suggestOverall = () => {
    const items = [state.cleanliness, state.vibration];
    if (items.includes("bad")) return "bad";
    if (items.includes("fixed")) return "fixed";
    return "ok";
  };
  const paintSeg = () => {
    form.querySelectorAll(".seg button").forEach((b) => b.setAttribute("aria-pressed", String(state[b.dataset.name] === b.dataset.val)));
    const sug = suggestOverall();
    document.getElementById("overall-hint").textContent =
      state.overall !== sug ? `จากรายการตรวจ ควรเป็น “${STATUS[sug].long}”` : `${STATUS[state.overall].form} ${STATUS[state.overall].long}`;
  };
  form.querySelectorAll(".seg button").forEach((b) => (b.onclick = () => {
    state[b.dataset.name] = b.dataset.val;
    if (b.dataset.name === "overall") overallTouched = true;
    else if (!overallTouched) state.overall = suggestOverall();
    paintSeg();
  }));
  paintSeg();

  const hint = (id, lvl) => {
    const el = document.getElementById(`${id}-hint`);
    const input = document.getElementById(id);
    input.classList.remove("danger", "warn");
    el.className = "hint" + (lvl ? ` ${lvl.cls}` : "");
    el.textContent = lvl ? lvl.text : "";
    if (lvl && (lvl.cls === "danger" || lvl.cls === "warn")) input.classList.add(lvl.cls);
  };
  const refreshHints = () => {
    hint("temp", tempLevel(form.temp.value));
    ["l1", "l2", "l3"].forEach((k) => hint(k, currentLevel(form[k].value, motor.amp)));
  };
  ["temp", "l1", "l2", "l3", "pressure", "level"].forEach((k) => form[k].addEventListener("input", refreshHints));
  refreshHints();

  const parseNum = (s) => {
    s = String(s).trim().replace(",", ".");
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  };

  form.onsubmit = async (e) => {
    e.preventDefault();
    const $err = document.getElementById("formError");
    $err.hidden = true;
    const body = {
      inspected_at: form.inspected_at.value,
      cleanliness: state.cleanliness, cleanliness_note: form.cleanliness_note.value,
      vibration: state.vibration, vibration_note: form.vibration_note.value,
      overall: state.overall, inspector: form.inspector.value.trim(), remark: form.remark.value,
    };
    const labels = { temp: "อุณหภูมิ", l1: "L1", l2: "L2", l3: "L3", pressure: "Pressure", level: "Level" };
    for (const k of Object.keys(labels)) {
      const n = parseNum(form[k].value);
      if (Number.isNaN(n)) { $err.textContent = `ค่า ${labels[k]} ต้องเป็นตัวเลข`; $err.hidden = false; form[k].focus(); return; }
      body[k] = n;
    }
    if (!body.inspected_at) { $err.textContent = "กรุณาเลือกวันที่ตรวจ"; $err.hidden = false; return; }
    if (!body.inspector) { $err.textContent = "กรุณากรอกชื่อผู้ตรวจ"; $err.hidden = false; form.inspector.focus(); return; }
    const btn = document.getElementById("save");
    btn.disabled = true;
    try {
      if (editing) await api(`/inspections/${ins.id}`, { method: "PUT", body });
      else await api(`/motors/${motor.id}/inspections`, { method: "POST", body });
      storeSet("inspector", body.inspector);
      toast(editing ? "บันทึกการแก้ไขแล้ว" : "บันทึกผลตรวจแล้ว");
      location.hash = `#/motor/${motor.id}`;
    } catch (err) {
      $err.textContent = err.message;
      $err.hidden = false;
      btn.disabled = false;
    }
  };

  if (editing) {
    document.getElementById("del").onclick = async () => {
      if (!(await ensureEngineer())) return;
      if (!(await confirmDialog("ต้องการลบข้อมูลการตรวจนี้ใช่หรือไม่", "ลบ", true))) return;
      try {
        await api(`/inspections/${ins.id}`, { method: "DELETE" });
        toast("ลบข้อมูลแล้ว");
        location.hash = `#/motor/${motor.id}`;
      } catch (err) {
        toast(err.message);
      }
    };
  }
}

// ---------- printable ISO sheet (same layout as the registered Word form) ----------
async function viewSheet(motorId, which) {
  const { motor, inspections, approvals } = await api(`/motors/${motorId}`);
  const sheetCount = Math.max(1, Math.ceil(inspections.length / ROWS_PER_SHEET));
  const numbers = which === "all" ? Array.from({ length: sheetCount }, (_, i) => i + 1) : [+which];
  setHeader({ title: `ฟอร์ม ${motor.tag}`, eyebrow: motor.plant, back: `#/motor/${motorId}` });

  const docxHref = `/api/export?motor=${motorId}&sheet=${which}`;
  $app.innerHTML = `<div class="sheet-toolbar no-print">
      <button class="btn primary" onclick="window.print()">${ICONS.print} พิมพ์ / บันทึก PDF</button>
      <a class="btn" href="${docxHref}">${ICONS.download} ดาวน์โหลด Word</a>
      ${sheetCount > 1 ? `<select class="input" style="width:auto;min-height:44px" id="pick" aria-label="เลือกแผ่น">
        ${Array.from({ length: sheetCount }, (_, i) => `<option value="${i + 1}" ${String(i + 1) === which ? "selected" : ""}>แผ่นที่ ${i + 1}</option>`).join("")}
        <option value="all" ${which === "all" ? "selected" : ""}>ทุกแผ่น</option></select>` : ""}
    </div>
    <div class="paper-wrap">${numbers
      .map((n) => isoSheet(motor, inspections.slice((n - 1) * ROWS_PER_SHEET, n * ROWS_PER_SHEET), approvals.find((a) => a.sheet_no === n)))
      .join("")}</div>`;
  const pick = document.getElementById("pick");
  if (pick) pick.onchange = () => (location.hash = `#/sheet/${motorId}/${pick.value}`);
}

function shortName(name) {
  const [first, last] = String(name).trim().split(/\s+/);
  if (!last) return first || "";
  return `${first} ${/^[เแโใไ]/.test(last) ? last.slice(0, 2) : last[0]}.`;
}

function shortDate(iso) {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y.slice(2)}`;
}

function isoSheet(motor, rows, approval) {
  const u = (v) => `<u>${esc(v)}</u>`;
  const specRow = (a, b) => `<td colspan="2" class="spec-cell">${a}</td><td class="spec-cell">${b}</td>`;
  const left = `<td></td>`.repeat(0);
  const remark = (i) =>
    [i.overall !== "ok" ? STATUS[i.overall].long : "", i.cleanliness_note && `ความสะอาด: ${i.cleanliness_note}`,
      i.vibration_note && `การสั่น: ${i.vibration_note}`, i.remark].filter(Boolean).join(" / ");
  const dataRow = (n) => {
    const i = rows[n - 1];
    if (!i) return `<tr class="data"><td class="c">${n}</td>${"<td></td>".repeat(10)}<td colspan="2"></td></tr>`;
    return `<tr class="data"><td class="c">${n}</td>
      <td class="sym">${STATUS[i.cleanliness].form}</td><td class="sym">${STATUS[i.vibration].form}</td>
      <td class="c">${numText(i.temp)}</td><td class="c">${numText(i.l1)}</td><td class="c">${numText(i.l2)}</td><td class="c">${numText(i.l3)}</td>
      <td class="c">${numText(i.pressure)}</td><td class="c">${numText(i.level)}</td>
      <td class="c sm" title="${esc(i.inspector)}">${esc(shortName(i.inspector))}</td><td class="c sm">${shortDate(i.inspected_at)}</td>
      <td colspan="2" class="rm" title="${esc(remark(i))}">${esc(remark(i))}</td></tr>`;
  };
  return `<div class="paper"><table class="iso">
    <colgroup>${[607, 544, 614, 614, 595, 540, 540, 630, 630, 810, 810, 1890, 2430].map((w) => `<col style="width:${(w / 11254) * 100}%">`).join("")}</colgroup>
    <tr><td colspan="13" class="title">รายการตรวจสอบเครื่องจักร : Weekly check sheet</td></tr>
    <tr>
      <td rowspan="9"></td>
      <td rowspan="9" class="vert">1.ตรวจเช็คความสะอาดมอเตอร์</td>
      <td rowspan="9" class="vert">2.ตรวจวัดการสั่นมอเตอร์</td>
      <td rowspan="9" class="vert">3.ตรวจวัดอุณหภูมิมอเตอร์ไม่เกิน 65˚C</td>
      <td rowspan="9" colspan="3" class="hcenter">4.ตรวจวัดกระแสไฟฟ้าของมอเตอร์ (A)</td>
      <td rowspan="9" class="vert">5.Pressure (barg.)</td>
      <td rowspan="9" class="vert">6.Level (%)</td>
      <td rowspan="9" class="vert">ผู้ตรวจเช็ค</td>
      ${specRow(`Tag No ${u(motor.tag)}`, `Tag Des. ${u(motor.description || "-")}`)}
    </tr>
    <tr>${specRow(`Brand ${u(motor.brand || "-")}`, `Type ${u(motor.type || "-")}`)}</tr>
    <tr>${specRow(`Power ${u(specVal(motor.kw))} KW`, `Voltage ${u(specVal(motor.volt))} V`)}</tr>
    <tr>${specRow(`Current ${u(specVal(motor.amp))} A`, `Speed ${u(specVal(motor.rpm))} RPM`)}</tr>
    <tr>${specRow(`Connection ${u(motor.connection || "-")}`, `Plant ${u(motor.plant)}`)}</tr>
    <tr><td colspan="2" class="spec-cell hcenter"><b>สัญลักษณ์ที่บันทึก</b></td><td></td></tr>
    <tr><td class="c">√</td><td>ไม่มีสิ่งผิดปกติ</td><td class="c">วิศวกร</td></tr>
    <tr><td class="c">X</td><td>มีสิ่งผิดปกติ</td><td class="c">${approval ? esc(approval.engineer) : ""}</td></tr>
    <tr><td class="c">Ⓧ</td><td>มีสิ่งผิดปกติแก้ไขแล้ว</td><td class="c">${approval ? shortDate(approval.approved_on) : "......./......../........"}</td></tr>
    <tr><td class="c">No.</td><td></td><td></td><td class="c">˚C</td><td class="c">L1</td><td class="c">L2</td><td class="c">L3</td>
      <td class="c">Barg.</td><td class="c">%</td><td></td><td class="c">ว/ด/ป</td><td colspan="2" class="c">หมายเหตุ</td></tr>
    ${Array.from({ length: ROWS_PER_SHEET }, (_, k) => dataRow(k + 1)).join("")}
    ${left}
  </table></div>`;
}

// ---------- dashboard ----------
async function viewDashboard(params) {
  const plants = await api("/plants");
  const plant = params.get("plant") || "";
  const d = new Date();
  const from = params.get("from") || `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
  const to = params.get("to") || today();
  setHeader({ title: "Dashboard สรุปผล", eyebrow: plant || "ทุก Plant", back: plant ? `#/plant/${encodeURIComponent(plant)}` : "#/" });

  const q = new URLSearchParams({ from, to });
  if (plant) q.set("plant", plant);
  const data = await api(`/dashboard?${q}`);
  const t = data.totals || {};
  const issueList = (rows, empty) =>
    rows.length
      ? `<div class="card">${rows
          .map((r) => `<a class="hist" href="#/inspection/${r.id}"><div class="hist-body">
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><strong>${esc(r.tag)}</strong><span class="muted">${esc(r.plant)}</span></div>
            <div>${esc(r.description)} · ${fmtDate(r.inspected_at, true)} · ${esc(r.inspector)}</div>
            ${r.remark ? `<div class="muted">${esc(r.remark)}</div>` : ""}</div><span class="chev">${ICONS.chev}</span></a>`)
          .join("")}</div>`
      : `<div class="card empty">${empty}</div>`;

  $app.innerHTML = `
    <form class="toolbar" id="dq">
      <div class="field"><label for="dp">Plant</label><select class="input" id="dp"><option value="">ทุก Plant</option>
        ${plants.map((p) => `<option ${p.name === plant ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></div>
      <div class="field"><label for="df">ตั้งแต่</label><input class="input" type="date" id="df" value="${from}"></div>
      <div class="field"><label for="dt">ถึง</label><input class="input" type="date" id="dt" value="${to}"></div>
      <button class="btn primary">ดูผล</button>
    </form>
    <div class="stats">
      <div class="card stat"><div class="k">จำนวนการตรวจทั้งหมด</div><div class="v">${t.total || 0}</div></div>
      <div class="card stat"><div class="k">เครื่องที่ตรวจแล้ว</div><div class="v">${t.motors_inspected || 0}<span class="muted" style="font-size:16px">/${data.motors}</span></div></div>
      <div class="card stat ok"><div class="k">√ ปกติ</div><div class="v">${t.ok || 0}</div></div>
      <div class="card stat bad"><div class="k">X ผิดปกติ</div><div class="v">${t.bad || 0}</div></div>
      <div class="card stat fixed"><div class="k">Ⓧ แก้ไขแล้ว</div><div class="v">${t.fixed || 0}</div></div>
    </div>
    <div class="section-title">เครื่องที่ยังผิดปกติอยู่ (ผลตรวจล่าสุด) <span class="pill bad">${data.open.length}</span></div>
    ${issueList(data.open, "ไม่มีเครื่องที่ค้างแก้ไข")}
    <div class="section-title">รายชื่อเครื่องที่ผิดปกติในช่วงนี้ <span class="pill bad">${data.bad.length}</span></div>
    ${issueList(data.bad, "ไม่มีรายการ")}
    <div class="section-title">รายชื่อเครื่องที่แก้ไขแล้วในช่วงนี้ <span class="pill fixed">${data.fixed.length}</span></div>
    ${issueList(data.fixed, "ไม่มีรายการ")}`;

  document.getElementById("dq").onsubmit = (e) => {
    e.preventDefault();
    const n = new URLSearchParams({ from: document.getElementById("df").value, to: document.getElementById("dt").value });
    const p = document.getElementById("dp").value;
    if (p) n.set("plant", p);
    location.hash = `#/dashboard?${n}`;
  };
}
