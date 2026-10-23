-- Plants and their motors (one Word table per motor in the ISO form)
CREATE TABLE plants (
  name TEXT PRIMARY KEY,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE motors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plant TEXT NOT NULL REFERENCES plants(name),
  tag TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  brand TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT '',
  kw REAL NOT NULL DEFAULT 0,
  volt REAL NOT NULL DEFAULT 0,
  amp REAL NOT NULL DEFAULT 0,
  rpm REAL NOT NULL DEFAULT 0,
  connection TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (plant, tag)
);
CREATE INDEX idx_motors_plant ON motors(plant, sort);

-- One row = one line (No. 1-30) on the weekly check sheet
-- status values: ok = √ ไม่มีสิ่งผิดปกติ, bad = X มีสิ่งผิดปกติ, fixed = Ⓧ มีสิ่งผิดปกติแก้ไขแล้ว
CREATE TABLE inspections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  motor_id INTEGER NOT NULL REFERENCES motors(id),
  inspected_at TEXT NOT NULL,            -- local time 'YYYY-MM-DDTHH:MM'
  cleanliness TEXT NOT NULL CHECK (cleanliness IN ('ok','bad','fixed')),
  cleanliness_note TEXT NOT NULL DEFAULT '',
  vibration TEXT NOT NULL CHECK (vibration IN ('ok','bad','fixed')),
  vibration_note TEXT NOT NULL DEFAULT '',
  temp REAL,
  l1 REAL,
  l2 REAL,
  l3 REAL,
  pressure REAL,
  level REAL,
  overall TEXT NOT NULL CHECK (overall IN ('ok','bad','fixed')),
  inspector TEXT NOT NULL,
  remark TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_inspections_motor ON inspections(motor_id, inspected_at, id);
CREATE INDEX idx_inspections_date ON inspections(inspected_at);

-- Engineer sign-off for one sheet (30 rows) of one motor
CREATE TABLE sheet_approvals (
  motor_id INTEGER NOT NULL REFERENCES motors(id),
  sheet_no INTEGER NOT NULL,
  engineer TEXT NOT NULL,
  approved_on TEXT NOT NULL,             -- 'YYYY-MM-DD'
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (motor_id, sheet_no)
);
