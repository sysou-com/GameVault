package com.sysou.gamevault.leaderboard;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.sysou.gamevault.achievement.AchievementApi;
import com.sysou.gamevault.catalog.CatalogApi;
import com.sysou.gamevault.common.api.ApiException;
import com.sysou.gamevault.common.redis.RateLimiter;
import com.sysou.gamevault.leaderboard.entity.UserScore;
import com.sysou.gamevault.leaderboard.repo.UserScoreRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 提分提交路径（01 文档 §6.1 校验链 + §2.2 限流；红线：分数只认平台裁决）。
 *
 * <p>提交只写 Redis（ZSET 榜 + pending 落库队列 + 幂等键），不碰 Postgres——P95 ≤ 100ms（01 §9）；
 * 落 user_score 表由 SCORE_SETTLE Job 每 5 分钟异步做（01 §2.1）。
 *
 * <p>Redis 键（01 §3）：lb:all:&lt;slug&gt; / lb:week:&lt;slug&gt;:&lt;yyyyww&gt;（ZSET，member=中心 UUID，
 * 值=分数，higherIsBetter=false 时存负值）；lb:pending:&lt;slug&gt;（List，SCORE_SETTLE 消费源）；
 * lb:name:&lt;userId&gt;（展示名）；lb:p99:&lt;slug&gt;（10min 缓存）；score:idem:&lt;userId&gt;:&lt;key&gt;（7d）。
 */
@Service
public class ScoreService {

    private static final Logger log = LoggerFactory.getLogger(ScoreService.class);
    private static final int SCORE_LIMIT = 20;             // 01 §2.2：每用户每游戏 20 次/10 分钟
    private static final Duration SCORE_WINDOW = Duration.ofMinutes(10);
    private static final Duration IDEM_TTL = Duration.ofDays(7);
    private static final Duration NAME_TTL = Duration.ofDays(30);

    private final CatalogApi catalog;
    private final AchievementApi achievements;
    private final UserScoreRepository scores;
    private final StringRedisTemplate redis;
    private final RateLimiter limiter;
    private final ObjectMapper mapper;

    public ScoreService(CatalogApi catalog, AchievementApi achievements, UserScoreRepository scores,
                        StringRedisTemplate redis, RateLimiter limiter, ObjectMapper mapper) {
        this.catalog = catalog;
        this.achievements = achievements;
        this.scores = scores;
        this.redis = redis;
        this.limiter = limiter;
        this.mapper = mapper;
    }

    public LeaderboardApi.SubmitResult submit(String userId, String userName, LeaderboardApi.SubmitRequest req) {
        String slug = req.gameSlug();
        // ① 限流（01 §2.2；游客禁止 = 调用方 AuthFilter 已 401，本层只认登录态 userId）
        if (!limiter.tryAllow("score", userId + ":" + slug, SCORE_LIMIT, SCORE_WINDOW)) {
            throw ApiException.tooMany("RATE_LIMITED", "提交过于频繁（每 10 分钟最多 20 次），请稍后再试");
        }
        // ② 幂等（01 §5.2：重复键 → 200 返回原结果）
        String idemKey = (req.idempotencyKey() == null || req.idempotencyKey().isBlank())
                ? UUID.randomUUID().toString() : req.idempotencyKey().trim();
        String idemRedisKey = "score:idem:" + userId + ":" + idemKey;
        String cached = redis.opsForValue().get(idemRedisKey);
        if (cached != null) {
            return parseResult(cached, idemKey);
        }
        // ③ spec（live manifest.score）
        ScoreSpec spec = ScoreSpec.fromManifest(catalog.liveManifest(slug));
        if (!spec.enabled()) throw ApiException.badRequest("SCORE_DISABLED", "该游戏未开放分数提交");
        Long score = req.score();
        if (score == null) throw ApiException.badRequest("BAD_SCORE", "score 必须是整数");
        // ④ 边界（§6.1.3）
        if (!ScoreValidator.inBounds(score, spec.min(), spec.max())) {
            recordRejected(userId, slug, score, Instant.now(), "分数超出合理区间 [" + spec.min() + ", " + spec.max() + "]");
            throw ApiException.badRequest("SCORE_OUT_OF_RANGE", "分数超出合理区间 [" + spec.min() + ", " + spec.max() + "]");
        }
        // ⑤ meta schema（§6.1.3：未知字段丢弃并告警）
        ScoreValidator.MetaResult metaRes = ScoreValidator.validateMeta(req.meta(), spec.metaSchema());
        for (String w : metaRes.warnings()) {
            log.warn("提分 meta 告警 userId={} slug={}: {}", userId, slug, w);
        }
        // ⑥ 时间合理性（§6.1.4）
        long now = System.currentTimeMillis();
        long clientTs = req.clientTs() != null ? req.clientTs() : now;
        Long sessionStart = sessionStartMs(req.playSessionId());
        String timeErr = ScoreValidator.checkTime(clientTs, now, sessionStart, spec.minPlayMs());
        if (timeErr != null) {
            recordRejected(userId, slug, score, Instant.ofEpochMilli(clientTs), timeErr);
            throw ApiException.badRequest("CLIENT_TS_INVALID", timeErr);
        }
        // ⑦ 异常检测（§6.1.5：P99×5 → flagged 进人工复核，不进榜）
        boolean flagged = ScoreValidator.isAnomalous(score, p99(slug));
        // ⑧ 落 Redis 榜 + pending 队列
        long stored = spec.higherIsBetter() ? score : -score;
        Long rank = null;
        if (!flagged) {
            String allKey = "lb:all:" + slug;
            redis.opsForZSet().add(allKey, userId, stored);
            redis.opsForZSet().add("lb:week:" + slug + ":" + WeekKey.current(Instant.now()), userId, stored);
            rank = rankOf(slug, userId);
        }
        redis.opsForValue().set("lb:name:" + userId, userName == null ? "" : userName, NAME_TTL);
        redis.opsForHash().putAll("lb:last:" + slug + ":" + userId,
                Map.of("meta", metaRes.meta().toString(), "at", Instant.now().toString()));
        redis.expire("lb:last:" + slug + ":" + userId, NAME_TTL);
        // pending（SCORE_SETTLE 消费；sid 去重）
        ObjectNode entry = mapper.createObjectNode();
        entry.put("sid", UUID.randomUUID().toString());
        entry.put("userId", userId);
        entry.put("gameSlug", slug);
        entry.put("score", score);
        entry.set("meta", metaRes.meta());
        entry.put("clientTs", Instant.ofEpochMilli(clientTs).toString());
        entry.put("status", flagged ? "flagged" : "ok");
        redis.opsForList().leftPush("lb:pending:" + slug, entry.toString());
        // ⑨ 成就（仅 ok；flagged 不发，待复核后不补发——保守红线）
        List<String> unlocked = flagged ? List.of()
                : achievements.evaluateAndGrant(userId, slug, score, metaRes.meta());
        LeaderboardApi.SubmitResult result = new LeaderboardApi.SubmitResult(
                flagged ? "flagged" : "ok", rank, score, unlocked,
                flagged ? "分数异常，已转人工复核（暂不上榜）" : null);
        try {
            redis.opsForValue().set(idemRedisKey, mapper.writeValueAsString(result), IDEM_TTL);
        } catch (Exception e) {
            log.warn("幂等键写入失败 userId={} slug={}: {}", userId, slug, e.toString());
        }
        log.info("提分 userId={} slug={} score={} flagged={} rank={} unlocked={}",
                userId, slug, score, flagged, rank, unlocked);
        return result;
    }

    /** 复核裁决（01 §6.1.5）：approve → 补进总榜/当周周榜；reject → 维持榜外。 */
    public void resolveFlagged(Long scoreId, boolean approve) {
        UserScore row = scores.findById(scoreId)
                .orElseThrow(() -> ApiException.notFound("SCORE_NOT_FOUND", "分数记录不存在：" + scoreId));
        if (!"flagged".equals(row.getStatus())) {
            throw ApiException.conflict("NOT_FLAGGED", "该记录不是 flagged 状态：" + row.getStatus());
        }
        ScoreSpec spec = ScoreSpec.fromManifest(catalog.liveManifest(row.getGameSlug()));
        if (approve) {
            long stored = spec.higherIsBetter() ? row.getScore() : -row.getScore();
            String allKey = "lb:all:" + row.getGameSlug();
            redis.opsForZSet().add(allKey, row.getUserId(), stored);
            redis.opsForZSet().add("lb:week:" + row.getGameSlug() + ":" + WeekKey.current(Instant.now()),
                    row.getUserId(), stored);
            row.setStatus("ok");
            row.setRejectReason(null);
            log.info("flagged 复核通过补榜 id={} userId={} slug={}", scoreId, row.getUserId(), row.getGameSlug());
        } else {
            row.setRejectReason("admin_rejected");
            log.info("flagged 复核拒绝 id={} userId={} slug={}", scoreId, row.getUserId(), row.getGameSlug());
        }
        scores.save(row);
    }

    /** 会话开始时刻（player 模块 sess:<id> hash；会话已清理/未提供 → null = 跳过时长检查，01 §6.1.4 M1 简化）。 */
    private Long rankOf(String slug, String userId) {
        Long r = redis.opsForZSet().reverseRank("lb:all:" + slug, userId);
        return r == null ? null : r + 1;
    }

    /** 会话开始时刻（player 模块 sess:<id> hash；会话已清理/未提供 → null = 跳过时长检查，01 §6.1.4 M1 简化）。 */
    private Long sessionStartMs(String playSessionId) {
        if (playSessionId == null || playSessionId.isBlank()) return null;
        try {
            Object v = redis.opsForHash().get("sess:" + playSessionId, "startedAt");
            return v == null ? null : Long.parseLong(String.valueOf(v));
        } catch (Exception e) {
            return null;
        }
    }

    /** 全服 P99（最近 1000 条 ok 分；10min Redis 缓存；空批=0 → 不 flag）。 */
    long p99(String slug) {
        String key = "lb:p99:" + slug;
        String cached = redis.opsForValue().get(key);
        if (cached != null) {
            try {
                return Long.parseLong(cached);
            } catch (NumberFormatException ignored) {
            }
        }
        List<Long> recent = scores
                .findTop1000ByGameSlugAndStatusOrderBySubmittedAtDesc(slug, "ok")
                .stream().map(UserScore::getScore).toList();
        long p = ScoreValidator.p99(recent);
        redis.opsForValue().set(key, String.valueOf(p), Duration.ofMinutes(10));
        return p;
    }

    /** 拒绝单也落审计行（status=rejected_bounds；同步写，量小）。 */
    private void recordRejected(String userId, String slug, long score, Instant clientTs, String reason) {
        try {
            UserScore u = new UserScore();
            u.setUserId(userId);
            u.setGameSlug(slug);
            u.setScore(score);
            u.setClientTs(clientTs);
            u.setStatus("rejected_bounds");
            u.setRejectReason(reason);
            scores.save(u);
        } catch (Exception e) {
            log.warn("拒绝单审计落库失败 userId={} slug={}: {}", userId, slug, e.toString());
        }
    }

    private LeaderboardApi.SubmitResult parseResult(String json, String idemKey) {
        try {
            JsonNode n = mapper.readTree(json);
            @SuppressWarnings("unchecked")
            List<String> unlocked = mapper.convertValue(n.path("unlocked"), List.class);
            return new LeaderboardApi.SubmitResult(
                    n.path("status").asText("ok"),
                    n.path("rank").isNumber() ? n.get("rank").asLong() : null,
                    n.path("score").isNumber() ? n.get("score").asLong() : null,
                    unlocked,
                    n.path("note").isTextual() ? n.get("note").asText() : null);
        } catch (Exception e) {
            log.warn("幂等结果解析失败 key={}（按未命中处理）: {}", idemKey, e.toString());
            throw new IllegalStateException("幂等结果解析失败", e);
        }
    }
}
