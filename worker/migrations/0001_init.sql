-- Usage counters. One row per (action, who, period): key is the user's uid, or '*' for the global total;
-- period is 'YYYY-MM-DD' (daily limits) or 'YYYY-MM' (monthly limits), in UTC.
CREATE TABLE usage (
  scope  TEXT NOT NULL,
  key    TEXT NOT NULL,
  period TEXT NOT NULL,
  count  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (scope, key, period)
) WITHOUT ROWID;

CREATE INDEX usage_period ON usage (period);

-- Instagram captions already fetched from RapidAPI (its free plan is only 100 requests a month,
-- so the same reel must never be asked for twice).
CREATE TABLE caption_cache (
  code       TEXT PRIMARY KEY,
  caption    TEXT NOT NULL,
  created_at INTEGER NOT NULL
) WITHOUT ROWID;
