package com.sysou.gamevault.player;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.util.Map;
import java.util.UUID;

/**
 * 试玩会话（01 文档 §2：M1 只埋点，M3 起遥测 Job 消费这些计数器）。
 *
 * <p>M1 最小实现：start 建会话 + 计数 started；end 计数 finished/duration。
 * 游客可用（无登录态）。key 规划见 01 文档 §3。
 */
@Service
public class PlaySessionService {

    private static final Logger log = LoggerFactory.getLogger(PlaySessionService.class);

    private final StringRedisTemplate redis;

    public PlaySessionService(StringRedisTemplate redis) {
        this.redis = redis;
    }

    /** @return playSessionId（12 位 hex） */
    public String start(String gameSlug) {
        String id = UUID.randomUUID().toString().replace("-", "").substring(0, 12);
        redis.opsForHash().putAll("sess:" + id, Map.of(
                "slug", gameSlug,
                "startedAt", String.valueOf(System.currentTimeMillis())));
        increment(gameSlug, "started", 1);
        return id;
    }

    /** @param durMs 游戏内时长（前端自报，M3 起用会话时间校验合理性） */
    public void end(String playSessionId, long durMs) {
        var ops = redis.opsForHash();
        String slug = (String) ops.get("sess:" + playSessionId, "slug");
        if (slug == null) {
            log.warn("play end 未知会话 {}", playSessionId);
            return;
        }
        increment(slug, "finished", 1);
        increment(slug, "duration", Math.max(0, durMs) / 1000);
        redis.delete("sess:" + playSessionId);
    }

    private void increment(String gameSlug, String field, long delta) {
        String key = "tel:" + gameSlug + ":" + LocalDate.now() + ":" + field;
        redis.opsForValue().increment(key, delta);
        // 30 天 TTL：TELEMETRY_AGG（M3）每日聚合后清，兜底过期
        redis.expire(key, java.time.Duration.ofDays(30));
    }
}
