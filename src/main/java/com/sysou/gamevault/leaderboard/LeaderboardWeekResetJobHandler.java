package com.sysou.gamevault.leaderboard;

import com.sysou.gamevault.catalog.CatalogApi;
import com.sysou.gamevault.common.job.JobHandler;
import com.sysou.gamevault.common.job.JobKinds;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.Map;

/**
 * LEADERBOARD_WEEK_RESET（01 §2.1/§6.1：每周一 00:00 周榜 key 轮换归档）。
 *
 * <p>归档 = lb:week:&lt;slug&gt;:&lt;上周桶&gt; → lb:week-archived:&lt;slug&gt;:&lt;上周桶&gt;（TTL 180d）；
 * 新周桶惰性创建（ZADD 自然建 key）。上周无数据（key 不存在）跳过。
 */
@Component
public class LeaderboardWeekResetJobHandler implements JobHandler {

    private static final Logger log = LoggerFactory.getLogger(LeaderboardWeekResetJobHandler.class);
    private static final Duration ARCHIVE_TTL = Duration.ofDays(180);

    private final CatalogApi catalog;
    private final StringRedisTemplate redis;

    public LeaderboardWeekResetJobHandler(CatalogApi catalog, StringRedisTemplate redis) {
        this.catalog = catalog;
        this.redis = redis;
    }

    @Override
    public String kind() {
        return JobKinds.LEADERBOARD_WEEK_RESET;
    }

    @Override
    public void handle(Map<String, String> payload, String idempotencyKey) {
        String prevWeek = payload.getOrDefault("prevWeek", WeekKey.previous(java.time.Instant.now()));
        int archived = 0;
        for (String slug : catalog.listLive().stream().map(CatalogApi.GameCard::slug).toList()) {
            String src = "lb:week:" + slug + ":" + prevWeek;
            if (Boolean.TRUE.equals(redis.hasKey(src))) {
                redis.rename(src, "lb:week-archived:" + slug + ":" + prevWeek);
                redis.expire("lb:week-archived:" + slug + ":" + prevWeek, ARCHIVE_TTL);
                archived++;
            }
        }
        log.info("LEADERBOARD_WEEK_RESET 完成 prevWeek={} archived={}", prevWeek, archived);
    }
}
