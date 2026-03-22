CREATE TABLE IF NOT EXISTS analyses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  team_id TEXT,
  cli_version TEXT NOT NULL,
  provider TEXT NOT NULL,
  model_used TEXT NOT NULL,
  message_count INTEGER NOT NULL,
  tool_use_count INTEGER,
  satisfaction_positive INTEGER NOT NULL,
  satisfaction_negative INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS frictions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  analysis_id INTEGER NOT NULL REFERENCES analyses(id),
  type TEXT NOT NULL,
  category TEXT NOT NULL,
  severity TEXT NOT NULL,
  count INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_frictions_type ON frictions(type);
CREATE INDEX IF NOT EXISTS idx_frictions_category ON frictions(category);
CREATE INDEX IF NOT EXISTS idx_analyses_created ON analyses(created_at);
