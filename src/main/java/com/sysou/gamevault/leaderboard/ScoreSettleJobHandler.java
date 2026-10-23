package com.sysou.gamevault.leaderboard;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sysou.gamevault.catalog.CatalogApi;
import com.sysou.gamevault.common.job.JobHandler;
import com.sysou.gamevault.common.job.JobKinds;
import com.sysou.gamevault.leaderboard.entity.UserScore;
import com.sysou.gamevault.leaderboard.repo.UserScoreRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;

/**
 * SCORE_SETTLE（01 §2.1：定时 5 分钟；Redis ZSET/pending → user_score 表异步落库）。
 *
 * <p>提交路径只写 Redis（01 §9 提分 P95 ≤ 100ms）；本 Job 把 lb:pending:&lt;slug&gt; 队列
 * 逐条落 user_score。幂等：entry.sid 去重键 score:settled:&lt;sid&gt;（7d）——Job 重放/死信重投
 * 不产生重复行。单轮每 slug 上限 500 条（防积压雪崩，超出下轮继续）。
 */
@Component
public class ScoreSettleJobHandler implements JobHandler {

    private static final Logger log = LoggerFactory.getLogger(ScoreSettleJobHandler.class);
    private static final int BATCH_PER_SLUG = 500;
    private static final Duration SETTLED_TTL = Duration.ofDays(7);

    private final CatalogApi catalog;
    private final UserScoreRepository scores;
    private final StringRedisTemplate redis;
    private final ObjectMapper mapper;

    public ScoreSettleJobHandler(CatalogApi catalog, UserScoreRepository scores,
                                 StringRedisTemplate redis, ObjectMapper mapper) {
        this.catalog = catalog;
        this.scores = scores;
        this.redis = redis;
        this.mapper = mapper;
    }

    @Override
    public String kind() {
        return JobKinds.SCORE_SETTLE;
    }

    @Override
    public void handle(Map<String, String> payload, String idempotencyKey) {
        List<String> slugs = catalog.listLive().stream()
                .map(CatalogApi.GameCard::slug).toList();
        int settled = 0;
        for (String slug : slugs) {
            String pending = "lb:pending:" + slug;
            for (int i = 0; i < BATCH_PER_SLUG; i++) {
                String raw = redis.opsForList().rightPop(pending);
                if (raw == null) break;
                if (settleOne(slug, raw)) settled++;
            }
        }
        if (settled > 0) {
            log.info("SCORE_SETTLE 完成 settled={} slugs={}", settled, slugs.size());
        }
    }

    /** @return true=落库成功；false=去重跳过/解析失败（丢弃并记日志） */
    private boolean settleOne(String slug, String raw) {
        try {
            JsonNode e = mapper.readTree(raw);
            String sid = e.path("sid").asText("");
            if (!sid.isEmpty() && Boolean.TRUE.equals(redis.hasKey("score:settled:" + sid))) {
                log.debug("SCORE_SETTLE 去重跳过 sid={}", sid);
                return false;
            }
            UserScore u = new UserScore();
            u.setUserId(e.path("userId").asText(""));
            u.setGameSlug(e.path("gameSlug").asText(slug));
            u.setScore(e.path("score").asLong(0));
            JsonNode meta = e.path("meta");
            u.setMeta(meta.isObject() ? meta.toString() : "{}");
            u.setClientTs(Instant.parse(e.path("clientTs").asText(Instant.now().toString())));
            u.setStatus(e.path("status").asText("ok"));
            scores.save(u);
            if (!sid.isEmpty()) {
                redis.opsForValue().set("score:settled:" + sid, "1", SETTLED_TTL);
            }
            return true;
        } catch (Exception ex) {
            log.warn("SCORE_SETTLE 条目落库失败（丢弃）slug={}: {}", slug, ex.toString());
            return false;
        }
    }
}
