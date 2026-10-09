CREATE TABLE dashboard_metrics (
  label TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  detail TEXT NOT NULL,
  tone TEXT NOT NULL CHECK (tone IN ('primary', 'accent', 'success')),
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE plans (
  name TEXT PRIMARY KEY NOT NULL,
  deposited TEXT NOT NULL,
  income_per_day TEXT NOT NULL,
  term TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Active', 'Ending soon')),
  note TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE referrals (
  person TEXT PRIMARY KEY NOT NULL,
  joined TEXT NOT NULL,
  contribution TEXT NOT NULL,
  commission TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Active', 'Pending')),
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE support_tools (
  name TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  state TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX dashboard_metrics_position_idx ON dashboard_metrics(position);
CREATE INDEX plans_position_idx ON plans(position);
CREATE INDEX referrals_position_idx ON referrals(position);
CREATE INDEX support_tools_position_idx ON support_tools(position);