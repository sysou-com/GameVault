package com.sysou.gamevault.common.job;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.connection.stream.MapRecord;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.Map;
import java.util.UUID;

/**
 * Redis Streams Job 生产端（01 文档 §2.1：消费组 + 死信流 + 幂等，与兄弟工程同款）。
 *
 * <p>消息体 = JSON（含 kind / idempotencyKey / payload）；重试计数放消息内（attempts），
 * 由 {@link JobConsumer} 决定重投或转死信。
 */
@Component
public class JobProducer {

    private static final Logger log = LoggerFactory.getLogger(JobProducer.class);

    private final StringRedisTemplate redis;
    private final ObjectMapper mapper;

    public JobProducer(StringRedisTemplate redis, ObjectMapper mapper) {
        this.redis = redis;
        this.mapper = mapper;
    }

    /**
     * @return jobId（= stream entry id，供管理台轮询状态关联）
     */
    public String publish(String kind, String idempotencyKey, Map<String, String> payload) {
        ObjectNode body = mapper.createObjectNode();
        body.put("kind", kind);
        body.put("idempotencyKey", idempotencyKey);
        body.put("attempts", "0");
        ObjectNode p = body.putObject("payload");
        payload.forEach(p::put);
        String entryId = redis.<String, String>opsForStream().add(
                MapRecord.<String, String, String>create(JobKinds.STREAM_JOBS,
                        Map.of("data", body.toString()))).getValue();
        log.info("job published kind={} idem={} id={}", kind, idempotencyKey, entryId);
        return entryId;
    }

    /** 管理台轮询用的最近状态快照（从 job:state:<idemKey> 读；由 handler 完成后写入）。 */
    public JsonNode state(String idempotencyKey) {
        String raw = redis.opsForValue().get("job:state:" + idempotencyKey);
        if (raw == null) return null;
        try {
            return mapper.readTree(raw);
        } catch (Exception e) {
            return null;
        }
    }

    /** 生成一个业务单据 id（12 位 hex，与兄弟工程任务号同款风格）。 */
    public static String newId() {
        return UUID.randomUUID().toString().replace("-", "").substring(0, 12);
    }

    /** 状态 TTL：7 天（管理台查历史足够；01 文档 §2.1 幂等留痕）。 */
    public static final Duration STATE_TTL = Duration.ofDays(7);
}
