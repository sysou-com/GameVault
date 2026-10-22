package com.sysou.gamevault.common.redis;

import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.mockito.ArgumentCaptor;

import java.time.Duration;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** Redis 限流单测（红线：计数走 Redis，禁 ConcurrentHashMap）。 */
class RateLimiterTest {

    @Test
    void allowsUpToLimitThenBlocks() {
        StringRedisTemplate redis = mock(StringRedisTemplate.class);
        @SuppressWarnings("unchecked")
        ValueOperations<String, String> ops = mock(ValueOperations.class);
        when(redis.opsForValue()).thenReturn(ops);
        when(ops.increment(anyString())).thenReturn(1L, 2L, 3L);

        RateLimiter rl = new RateLimiter(redis);

        assertTrue(rl.tryAllow("score", "u1:neon-raid", 2, Duration.ofMinutes(10)));
        assertTrue(rl.tryAllow("score", "u1:neon-raid", 2, Duration.ofMinutes(10)));
        assertFalse(rl.tryAllow("score", "u1:neon-raid", 2, Duration.ofMinutes(10)));

        // 首次计数设置 TTL（2 个窗口；expire 在 RedisTemplate 上，不在 ValueOperations 上）
        ArgumentCaptor<Duration> ttl = ArgumentCaptor.forClass(Duration.class);
        verify(ops, times(3)).increment(anyString());
        verify(redis).expire(anyString(), ttl.capture());
        assertEquals(Duration.ofMinutes(20), ttl.getValue());
    }

    @Test
    void differentKeysAreIndependent() {
        StringRedisTemplate redis = mock(StringRedisTemplate.class);
        @SuppressWarnings("unchecked")
        ValueOperations<String, String> ops = mock(ValueOperations.class);
        when(redis.opsForValue()).thenReturn(ops);
        when(ops.increment(anyString())).thenReturn(1L);

        RateLimiter rl = new RateLimiter(redis);

        assertTrue(rl.tryAllow("score", "u1", 1, Duration.ofMinutes(10)));
        assertTrue(rl.tryAllow("score", "u2", 1, Duration.ofMinutes(10)));
    }
}
