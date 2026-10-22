package com.sysou.gamevault.common.redis;

import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.time.Duration;

/**
 * Redis 限流（固定窗口；红线：限流计数禁止 ConcurrentHashMap —— 兄弟工程同款纪律）。
 *
 * <p>窗口槽位 = 当前整窗口序号，天然实现「每 window 最多 limit 次」。
 * key 形如 {@code limit:<scope>:<key>:<windowSlot>}，TTL = 2 个窗口（防边界残留）。
 */
@Component
public class RateLimiter {

    private final StringRedisTemplate redis;

    public RateLimiter(StringRedisTemplate redis) {
        this.redis = redis;
    }

    /** @return true=放行；false=超限 */
    public boolean tryAllow(String scope, String key, int limit, Duration window) {
        long slot = System.currentTimeMillis() / 1000 / window.getSeconds();
        String k = "limit:" + scope + ":" + key + ":" + slot;
        Long count = redis.opsForValue().increment(k);
        if (count != null && count == 1L) {
            redis.expire(k, window.multipliedBy(2));
        }
        return count != null && count <= limit;
    }
}
