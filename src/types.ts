export type Status = "ok" | "bad" | "fixed";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  // secrets (wrangler secret put …)
  TECH_PIN: string;
  ENGINEER_PIN: string;
  SESSION_SECRET: string;
}

export interface Motor {
  id: number;
  plant: string;
  tag: string;
  description: string;
  brand: string;
  type: string;
  kw: number;
  volt: number;
  amp: number;
  rpm: number;
  connection: string;
  sort: number;
}

export interface Inspection {
  id: number;
  motor_id: number;
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
  created_at: string;
  updated_at: string;
}

export interface Approval {
  motor_id: number;
  sheet_no: number;
  engineer: string;
  approved_on: string;
}
