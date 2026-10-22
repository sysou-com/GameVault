-- GameVault V1__init.sql（docs/design/01 §3 数据模型）
-- 结构只由 Flyway 管（ddl-auto=validate）。

CREATE TABLE game (
  id            BIGSERIAL PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,          -- 对外标识，URL 用：neon-raid
  title         TEXT NOT NULL,                 -- 霓虹突袭
  subtitle      TEXT,
  engine        TEXT NOT NULL,                 -- phaser-4 | threejs | godot-4.6 | canvas-native
  language      TEXT NOT NULL,                 -- typescript | gdscript
  cover_url     TEXT NOT NULL,                 -- 封面（/game/g/<slug>/cover.png）
  description   TEXT,                          -- 简介（中文）
  tech_notes_url TEXT,                         -- 技术拆解文档链接（P5）
  media         JSONB NOT NULL DEFAULT '{}',   -- N0 预留（08 文档 §8）：screenshots/trailer/external_links
  tags          TEXT[],
  status        TEXT NOT NULL DEFAULT 'draft', -- draft | live | disabled
  sort_order    INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE game_version (
  id            BIGSERIAL PRIMARY KEY,
  game_id       BIGINT NOT NULL REFERENCES game(id),
  version       TEXT NOT NULL,                 -- semver：1.0.0
  manifest      JSONB NOT NULL,                -- 冻结的 manifest.json 副本（02 文档 §3.1）
  entry_url     TEXT NOT NULL,                 -- /game/g/<slug>/<version>/index.html
  package_sha256 TEXT NOT NULL,
  size_bytes    BIGINT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'staged',-- staged | live | rolled_back | failed
  status_report JSONB,                         -- 校验/处理报告（失败原因逐项）
  published_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (game_id, version)
);
CREATE INDEX idx_version_game ON game_version (game_id, status);

-- M2
CREATE TABLE user_score (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT NOT NULL,               -- sysou-manage 用户 id（中心表，不建本地用户）
  game_slug     TEXT NOT NULL,
  score         BIGINT NOT NULL,
  meta          JSONB NOT NULL DEFAULT '{}',
  client_ts     TIMESTAMPTZ NOT NULL,
  submitted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  status        TEXT NOT NULL DEFAULT 'ok',    -- ok | rejected_bounds | flagged
  reject_reason TEXT
);
CREATE INDEX idx_score_board ON user_score (game_slug, submitted_at);
CREATE INDEX idx_score_user ON user_score (user_id, game_slug);

CREATE TABLE achievement_def (
  id            BIGSERIAL PRIMARY KEY,
  game_slug     TEXT NOT NULL,
  code          TEXT NOT NULL,                 -- FIRST_CLEAR | SCORE_10K
  title         TEXT NOT NULL,
  description   TEXT NOT NULL,
  rule          JSONB NOT NULL,                -- 声明式规则（01 文档 §6.2）：{"type":"score_gte","value":10000}
  icon_url      TEXT,
  UNIQUE (game_slug, code)
);

CREATE TABLE achievement_grant (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT NOT NULL,
  game_slug     TEXT NOT NULL,
  achievement_id BIGINT NOT NULL REFERENCES achievement_def(id),
  granted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, achievement_id)
);

-- M3
CREATE TABLE play_event_daily (
  id            BIGSERIAL PRIMARY KEY,
  stat_date     DATE NOT NULL,
  game_slug     TEXT NOT NULL,
  pv            BIGINT NOT NULL DEFAULT 0,
  play_started  BIGINT NOT NULL DEFAULT 0,
  play_finished BIGINT NOT NULL DEFAULT 0,
  duration_sec  BIGINT NOT NULL DEFAULT 0,     -- 累计
  score_p50     INT, score_p90 INT,
  UNIQUE (stat_date, game_slug)
);

-- M3（云存档 P7，01 文档 §5.2 / 02 文档 §4.4）
CREATE TABLE user_save (
  id             BIGSERIAL PRIMARY KEY,
  user_id        BIGINT NOT NULL,
  game_slug      TEXT NOT NULL,
  slot           TEXT NOT NULL DEFAULT 'default',
  data           JSONB NOT NULL,               -- 对平台不透明；JSON only；≤256KB/槽
  schema_version INT NOT NULL DEFAULT 1,
  size_bytes     INT NOT NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, game_slug, slot)
);
CREATE INDEX idx_save_user ON user_save (user_id, game_slug);
