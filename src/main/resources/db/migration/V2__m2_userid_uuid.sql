-- GameVault V2 (M2): user_id 类型修正 + 榜单/复核索引
--
-- 中心账号 id 是 UUID（sysou-manage V1__identity.sql: account.id UUID PRIMARY KEY，JWT sub 即此值；
-- 2026-10-24 核中心代码后修正）——V1 里 user_score/achievement_grant/user_save 的 user_id BIGINT
-- 是设计稿笔误（01 文档 §3 同步更正）。M2/M3 表尚未使用（2026-10-23 部署后零数据），就地改型零迁移。
ALTER TABLE user_score        ALTER COLUMN user_id TYPE TEXT;
ALTER TABLE achievement_grant ALTER COLUMN user_id TYPE TEXT;
ALTER TABLE user_save         ALTER COLUMN user_id TYPE TEXT;

-- P99 异常检测（最近 1000 条 ok 分，01 文档 §6.1.5）+ 管理台 flagged 复核查询
CREATE INDEX idx_score_status ON user_score (game_slug, status, submitted_at DESC);
