package com.sysou.gamevault.leaderboard;

import com.sysou.gamevault.common.job.JobKinds;
import com.sysou.gamevault.common.job.JobProducer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.Map;

/**
 * 榜单定时 Job 触发（01 §2.1）：
 * <ul>
 *   <li>SCORE_SETTLE：每 5 分钟（提交路径只写 Redis，异步落 user_score 表）</li>
 *   <li>LEADERBOARD_WEEK_RESET：每周一 00:00（服务器时区）周榜归档</li>
 * </ul>
 * 触发走 Redis Streams Job（消费组 + 死信 + 幂等，与游戏包 Job 同框架）；单机部署单触发源无竞态。
 */
@Component
public class LeaderboardScheduler {

    private static final Logger log = LoggerFactory.getLogger(LeaderboardScheduler.class);

    private final JobProducer producer;

    public LeaderboardScheduler(JobProducer producer) {
        this.producer = producer;
    }

    /** 5 分钟一拍；idem 键 = 5 分钟槽号（重触发同槽幂等跳过）。 */
    @Scheduled(fixedDelay = 5 * 60_000, initialDelay = 60_000)
    public void settle() {
        long slot = System.currentTimeMillis() / (5 * 60_000);
        producer.publish(JobKinds.SCORE_SETTLE, "settle-" + slot, Map.of());
    }

    /** 周一 00:00 归档上一周桶（01 §6.1）。 */
    @Scheduled(cron = "0 0 0 * * MON")
    public void weekReset() {
        String prevWeek = WeekKey.previous(Instant.now());
        producer.publish(JobKinds.LEADERBOARD_WEEK_RESET, "lbw-" + prevWeek, Map.of("prevWeek", prevWeek));
    }
}
