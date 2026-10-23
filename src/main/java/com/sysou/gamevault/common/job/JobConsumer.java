package com.sysou.gamevault.common.job;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.connection.stream.Consumer;
import org.springframework.data.redis.connection.stream.MapRecord;
import org.springframework.data.redis.connection.stream.ReadOffset;
import org.springframework.data.redis.connection.stream.StreamOffset;
import org.springframework.data.redis.connection.stream.StreamReadOptions;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.net.InetAddress;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Redis Streams Job 消费者（01 文档 §5.5：消费组 + 死信流 + 幂等）。
 *
 * <p>常驻轮询：{@code XREADGROUP ... >} 阻塞 150ms/批 → 幂等检查 → 分派 handler →
 * ACK；失败重试（XADD 回主队列 + attempts 递增，上限 5）→ 超限进死信流 {@code gv:jobs:dead}。
 * <p>handler 同步执行（Job 都是分钟内的短任务；长动作的「后台化」指 API 不阻塞，见 02 文档 §5.2）。
 * <p>SDR 3.4 API（已按本机 3.4.5 jar 核实）：createGroup(stream, ReadOffset, group)、
 * read(Consumer, StreamReadOptions, StreamOffset...)、MapRecord.create(stream, map)。
 */
@Component
public class JobConsumer {

    private static final Logger log = LoggerFactory.getLogger(JobConsumer.class);
    private static final ObjectMapper M = new ObjectMapper();
    private static final int MAX_ATTEMPTS = 5;

    private final StringRedisTemplate redis;
    private final Map<String, JobHandler> handlers;
    private final String consumerName;

    private ScheduledExecutorService scheduler;
    private final AtomicBoolean groupReady = new AtomicBoolean(false);

    public JobConsumer(StringRedisTemplate redis, List<JobHandler> handlerBeans) {
        this.redis = redis;
        this.handlers = handlerBeans.stream()
                .collect(java.util.stream.Collectors.toMap(JobHandler::kind, h -> h));
        String host;
        try { host = InetAddress.getLocalHost().getHostName(); } catch (Exception e) { host = "host"; }
        // 消费组内多个消费者：主机名 + 4 位进程随机，避免撞名
        this.consumerName = host + "-" + Integer.toHexString((int) (System.nanoTime() & 0xffffL));
    }

    @PostConstruct
    void start() {
        scheduler = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "job-consumer");
            t.setDaemon(true);
            return t;
        });
        scheduler.scheduleWithFixedDelay(this::safePoll, 1000, 250, TimeUnit.MILLISECONDS);
    }

    @PreDestroy
    void stop() {
        if (scheduler != null) scheduler.shutdownNow();
    }

    private void safePoll() {
        try { pollOnce(); }
        catch (Exception e) {
            log.warn("Job 消费轮询失败（下次重试）", e);
            groupReady.set(false);   // 可能是建组/流未就绪，下轮重建
        }
    }

    private void pollOnce() {
        // 流尚不存在（未发过任何 job）时跳过：XGROUP CREATE / XREADGROUP 都会报 NOGROUP/ERR
        if (!groupReady.get() && !Boolean.TRUE.equals(redis.hasKey(JobKinds.STREAM_JOBS))) {
            return;
        }
        ensureGroup();
        List<MapRecord<String, String, String>> records = redis.<String, String>opsForStream().read(
                Consumer.from(JobKinds.GROUP, consumerName),
                StreamReadOptions.empty().block(Duration.ofMillis(150)).count(16),
                StreamOffset.create(JobKinds.STREAM_JOBS, ReadOffset.from(">")));
        for (MapRecord<String, String, String> rec : records) {
            try {
                process(rec);
            } catch (Exception e) {
                log.error("Job 处理异常（重入队/死信）stream={} id={}: {}",
                        JobKinds.STREAM_JOBS, rec.getId(), e.toString(), e);
                requeue(rec, e);
            }
        }
    }

    /** 消费组惰性创建：createGroup 无 MKSTREAM 选项，流不存在时会失败——重试即可（首个 XADD 建流）。 */
    private void ensureGroup() {
        if (groupReady.get()) return;
        try {
            // 初始建组从流头（0-0）而非 latest()：若 job 先 XADD、组后建（首次发布时的竞态），
            // latest() 会让已入队消息对 ">" 永远不可见（Job 永久 UNKNOWN）；0-0 + job 幂等键（job:done）
            // 保证重复投递安全（2026-10-23 生产首发实测暴露）。
            redis.opsForStream().createGroup(JobKinds.STREAM_JOBS, ReadOffset.from("0-0"), JobKinds.GROUP);
            groupReady.set(true);
            log.info("Job 消费组已就绪 group={} consumer={}", JobKinds.GROUP, consumerName);
        } catch (Exception e) {
            if (isBusyGroup(e)) {
                groupReady.set(true);
                log.info("Job 消费组已存在（幂等视为就绪）group={}", JobKinds.GROUP);
            } else {
                log.debug("消费组未就绪（流尚不存在或已创建）: {}", e.toString());
            }
        }
    }

    /** SDR 把 Redis 错误包在 cause 链里，逐层找 BUSYGROUP（组已存在 = 幂等成功）。 */
    private static boolean isBusyGroup(Throwable e) {
        for (Throwable t = e; t != null; t = t.getCause()) {
            if (String.valueOf(t.getMessage()).contains("BUSYGROUP")) return true;
        }
        return false;
    }

    private void process(MapRecord<String, String, String> rec) {
        String data = rec.getValue() == null ? null : rec.getValue().get("data");
        if (data == null) {
            log.warn("Job 消息无 data 字段，直接 ACK id={}", rec.getId());
            ack(rec);
            return;
        }
        JsonNode body;
        try {
            body = M.readTree(data);
        } catch (Exception e) {
            deadLetter(rec, "unparseable", data);
            ack(rec);
            return;
        }
        String kind = body.path("kind").asText("");
        String idempotencyKey = body.path("idempotencyKey").asText("");
        int attempts = body.path("attempts").asInt(0);

        // 幂等（01 §5.5）：job:done:{key} 存在 → 跳过
        if (!idempotencyKey.isEmpty() && Boolean.TRUE.equals(redis.hasKey("job:done:" + idempotencyKey))) {
            log.debug("Job 幂等跳过 key={}", idempotencyKey);
            ack(rec);
            return;
        }

        JobHandler handler = handlers.get(kind);
        if (handler == null) {
            deadLetter(rec, "noHandler", data);
            ack(rec);
            return;
        }

        Map<String, String> payload = new java.util.LinkedHashMap<>();
        body.path("payload").fields().forEachRemaining(e -> payload.put(e.getKey(), e.getValue().asText()));
        try {
            handler.handle(payload, idempotencyKey);
            if (!idempotencyKey.isEmpty()) {
                redis.opsForValue().set("job:done:" + idempotencyKey,
                        String.valueOf(System.currentTimeMillis()), Duration.ofDays(7));
            }
            setState(idempotencyKey, "done", null);
            ack(rec);
        } catch (RuntimeException fail) {
            if (attempts + 1 >= MAX_ATTEMPTS) {
                deadLetter(rec, fail.getMessage(), data);
                ack(rec);   // 进死信即从主队列移除（01 §5.5）
            } else {
                requeue(rec, fail);
            }
        }
    }

    /** 失败重试：XADD 回主队列，attempts+1（01 §5.5）。 */
    private void requeue(MapRecord<String, String, String> rec, Throwable cause) {
        String data = rec.getValue() == null ? "" : rec.getValue().get("data");
        try {
            JsonNode body = M.readTree(data);
            ObjectNode nb = (ObjectNode) body;
            nb.put("attempts", nb.path("attempts").asInt(0) + 1);
            nb.put("lastError", String.valueOf(cause.getMessage()));
            redis.opsForStream().add(
                    MapRecord.<String, String, String>create(JobKinds.STREAM_JOBS,
                            Map.of("data", nb.toString())));
            ObjectNode ex = M.createObjectNode();
            ex.put("attempts", nb.path("attempts").asInt());
            setState(nb.path("idempotencyKey").asText(""), "retrying", ex);
            log.warn("Job 重入队 id={} attempts={}", rec.getId(), nb.path("attempts").asInt());
        } catch (Exception e) {
            deadLetter(rec, "requeueFailed", data);
            ack(rec);
        }
    }

    /** 死信：XADD 死信流，保留原始数据，供人工介入（管理台 M2 提供重放）。 */
    private void deadLetter(MapRecord<String, String, String> rec, String reason, String originalData) {
        try {
            ObjectNode b = M.createObjectNode();
            b.put("originalStream", JobKinds.STREAM_JOBS);
            b.put("originalId", rec.getId() == null ? "" : rec.getId().getValue());
            b.put("reason", String.valueOf(reason));
            b.put("data", originalData == null ? "" : originalData);
            b.put("at", java.time.Instant.now().toString());
            redis.opsForStream().add(
                    MapRecord.<String, String, String>create(JobKinds.STREAM_DEAD,
                            Map.of("data", b.toString())));
            String idem = "";
            try { idem = M.readTree(originalData).path("idempotencyKey").asText(""); } catch (Exception ignored) {
            }
            ObjectNode ex = M.createObjectNode();
            ex.put("reason", String.valueOf(reason));
            setState(idem, "dead", ex);
            log.error("Job 进死信流 reason={} originalId={}", reason, rec.getId());
        } catch (Exception e) {
            log.error("Job 死信写入失败（消息将丢失，需人工介入）: {}", e.toString(), e);
        }
    }

    private void ack(MapRecord<String, String, String> rec) {
        redis.opsForStream().acknowledge(JobKinds.STREAM_JOBS, JobKinds.GROUP, rec.getId());
    }

    /** 管理台轮询用的状态快照 job:state:<idemKey>（01 文档 §5.5；TTL 7 天）。 */
    private void setState(String idempotencyKey, String status, JsonNode extra) {
        if (idempotencyKey == null || idempotencyKey.isEmpty()) return;
        try {
            ObjectNode o = M.createObjectNode();
            o.put("status", status);
            if (extra != null) {
                extra.fields().forEachRemaining(en -> o.set(en.getKey(), en.getValue()));
            }
            redis.opsForValue().set("job:state:" + idempotencyKey, o.toString(), Duration.ofDays(7));
        } catch (Exception e) {
            log.warn("Job 状态快照写入失败: {}", e.toString());
        }
    }
}
