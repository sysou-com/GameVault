package com.sysou.gamevault.common.job;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentMatchers;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.redis.connection.stream.Consumer;
import org.springframework.data.redis.connection.stream.MapRecord;
import org.springframework.data.redis.connection.stream.RecordId;
import org.springframework.data.redis.connection.stream.StreamOffset;
import org.springframework.data.redis.connection.stream.StreamReadOptions;
import org.springframework.data.redis.core.StreamOperations;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class JobConsumerTest {

    @Mock StringRedisTemplate redis;
    @Mock StreamOperations<String, String, String> ops;
    @Mock ValueOperations<String, String> valueOps;

    private JobConsumer consumer;

    @BeforeEach
    void setUp() {
        lenient().when(redis.<String, String>opsForStream()).thenReturn(ops);
        lenient().when(redis.opsForValue()).thenReturn(valueOps);
        lenient().when(redis.hasKey(JobKinds.STREAM_JOBS)).thenReturn(true);
    }

    /** 单条入队 → handler 执行 → ACK。 */
    @Test
    void successAcks() {
        RecordingHandler handler = new RecordingHandler();
        consumer = new JobConsumer(redis, List.of(handler));
        when(ops.read(any(Consumer.class), any(StreamReadOptions.class), any(StreamOffset[].class)))
                .thenReturn(List.of(record("{\"kind\":\"TEST\",\"idempotencyKey\":\"a\",\"attempts\":\"0\",\"payload\":{}}")));
        pollForTest();
        verify(ops).acknowledge(eq(JobKinds.STREAM_JOBS), eq(JobKinds.GROUP), eq(RecordId.of("1-1")));
        assertEquals(1, handler.count, "handler 未执行");
    }

    /** 重复消息（幂等键已 done）→ 跳过执行但 ACK。 */
    @Test
    void idempotentSkips() {
        RecordingHandler handler = new RecordingHandler();
        consumer = new JobConsumer(redis, List.of(handler));
        when(redis.hasKey("job:done:a")).thenReturn(true);
        when(ops.read(any(Consumer.class), any(StreamReadOptions.class), any(StreamOffset[].class)))
                .thenReturn(List.of(record("{\"kind\":\"TEST\",\"idempotencyKey\":\"a\",\"attempts\":\"0\",\"payload\":{}}")));
        pollForTest();
        verify(ops).acknowledge(eq(JobKinds.STREAM_JOBS), eq(JobKinds.GROUP), eq(RecordId.of("1-1")));
        assertEquals(0, handler.count, "幂等消息不应执行");
    }

    /** 处理失败且 attempts 未超限 → XADD 回主队列（attempts+1），不 ACK。 */
    @Test
    void failureRequeuesWithAttemptsIncrement() {
        consumer = new JobConsumer(redis, List.of(new ThrowingHandler()));
        when(ops.read(any(Consumer.class), any(StreamReadOptions.class), any(StreamOffset[].class)))
                .thenReturn(List.of(record("{\"kind\":\"TEST\",\"idempotencyKey\":\"b\",\"attempts\":\"1\",\"payload\":{}}")));
        pollForTest();
        verify(ops).add(ArgumentMatchers.argThat(r -> {
            @SuppressWarnings("unchecked") var v = ((MapRecord<String, String, String>) r).getValue();
            return v != null && v.get("data") != null && v.get("data").contains("\"attempts\":2");
        }));
        verify(ops, never()).acknowledge(anyString(), anyString(), any(RecordId.class));
    }

    /** 处理失败且 attempts 达上限 → 进死信流并 ACK。 */
    @Test
    void failureAtMaxGoesToDeadLetter() {
        consumer = new JobConsumer(redis, List.of(new ThrowingHandler()));
        when(ops.read(any(Consumer.class), any(StreamReadOptions.class), any(StreamOffset[].class)))
                .thenReturn(List.of(record("{\"kind\":\"TEST\",\"idempotencyKey\":\"c\",\"attempts\":\"5\",\"payload\":{}}")));
        pollForTest();
        verify(ops).add(ArgumentMatchers.argThat(r -> JobKinds.STREAM_DEAD.equals(r.getStream())));
        verify(ops).acknowledge(eq(JobKinds.STREAM_JOBS), eq(JobKinds.GROUP), eq(RecordId.of("1-1")));
    }

    /** 未知 kind → 死信 + ACK（不重入队）。 */
    @Test
    void unknownKindGoesToDeadLetter() {
        consumer = new JobConsumer(redis, List.of(new RecordingHandler()));
        when(ops.read(any(Consumer.class), any(StreamReadOptions.class), any(StreamOffset[].class)))
                .thenReturn(List.of(record("{\"kind\":\"UNKNOWN\",\"idempotencyKey\":\"\",\"attempts\":\"0\",\"payload\":{}}")));
        pollForTest();
        verify(ops).add(ArgumentMatchers.argThat(r -> JobKinds.STREAM_DEAD.equals(r.getStream())));
        verify(ops).acknowledge(eq(JobKinds.STREAM_JOBS), eq(JobKinds.GROUP), eq(RecordId.of("1-1")));
    }

    private static MapRecord<String, String, String> record(String data) {
        return MapRecord.<String, String, String>create(JobKinds.STREAM_JOBS, Map.of("data", data))
                .withId(RecordId.of("1-1"));
    }

    /** 测试钩子：把常驻轮询的单次 poll 暴露出来（生产路径不变）。 */
    void pollForTest() {
        try {
            java.lang.reflect.Method m = JobConsumer.class.getDeclaredMethod("pollOnce");
            m.setAccessible(true);
            m.invoke(consumer);
        } catch (java.lang.reflect.InvocationTargetException e) {
            if (e.getCause() instanceof RuntimeException re) throw re;
            throw new IllegalStateException(e);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    static class RecordingHandler implements JobHandler {
        int count;
        public String kind() { return "TEST"; }
        public void handle(Map<String, String> p, String idem) { count++; }
    }

    static class ThrowingHandler implements JobHandler {
        public String kind() { return "TEST"; }
        public void handle(Map<String, String> p, String idem) { throw new IllegalStateException("boom"); }
    }
}
