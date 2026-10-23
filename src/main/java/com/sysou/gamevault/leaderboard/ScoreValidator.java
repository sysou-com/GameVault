package com.sysou.gamevault.leaderboard;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;

import java.util.ArrayList;
import java.util.List;

/**
 * 提分校验链纯函数（01 文档 §6.1；红线：分数只认平台裁决，判定全部服务端）。
 *
 * <p>本类<b>无 Spring 依赖、无 IO</b>——单测直接覆盖（01 文档 §10：校验链纯函数化）。
 * 编排（限流/幂等/落 Redis）在 {@link ScoreService}。
 */
public final class ScoreValidator {

    private static final ObjectMapper M = new ObjectMapper();
    private static final long CLIENT_TS_MIN_AGE_MS = 5 * 60_000;   // 不早于当前 -5min
    private static final long CLIENT_TS_MAX_FUTURE_MS = 2 * 60_000; // 不晚于当前 +2min
    private static final long ANOMALY_P99_MULT = 5;                 // 超全服 P99×5 → flagged

    private ScoreValidator() {
    }

    /** §6.1.3 边界：score ∈ [min, max]（整数由请求绑定层保证 Long 解析）。 */
    public static boolean inBounds(long score, long min, long max) {
        return score >= min && score <= max;
    }

    /** meta 校验结果：cleaned = 只含 schema 声明且类型/区间通过的字段；warnings = 丢弃原因（告警日志用）。 */
    public record MetaResult(JsonNode meta, List<String> warnings) {
    }

    /**
     * §6.1.3：meta 字段按 schema 校验，未知字段<b>丢弃并告警</b>（不拒绝整单）。
     * schema 条目：{"type":"int"|"string"|"bool", "range":[lo,hi]（仅 int）}；缺 type 视为 any（保留）。
     */
    public static MetaResult validateMeta(JsonNode meta, JsonNode metaSchema) {
        List<String> warnings = new ArrayList<>();
        ObjectNode out;
        if (meta == null || meta.isMissingNode() || meta.isNull() || !meta.isObject()) {
            out = M.createObjectNode();
        } else {
            out = (ObjectNode) meta.deepCopy();
        }
        if (metaSchema == null || metaSchema.isMissingNode() || metaSchema.isNull() || !metaSchema.isObject()) {
            return new MetaResult(out, warnings);
        }
        List<String> unknown = new ArrayList<>();
        List<String> fields = new ArrayList<>();
        out.fieldNames().forEachRemaining(fields::add);
        for (String field : fields) {
            JsonNode spec = metaSchema.get(field);
            if (spec == null) {
                unknown.add(field);
                continue;
            }
            JsonNode value = out.get(field);
            String type = spec.path("type").asText("any");
            boolean ok = switch (type) {
                case "int" -> value != null && value.isIntegralNumber() && inRange(value.asLong(), spec);
                case "string" -> value != null && value.isTextual();
                case "bool" -> value != null && value.isBoolean();
                default -> true;
            };
            if (!ok) {
                warnings.add("meta." + field + " 类型/区间不符（type=" + type + "），已丢弃");
                out.remove(field);
            }
        }
        for (String field : unknown) {
            warnings.add("meta." + field + " 未在 manifest.score.metaSchema 声明，已丢弃");
            out.remove(field);
        }
        return new MetaResult(out, warnings);
    }

    private static boolean inRange(long v, JsonNode spec) {
        JsonNode range = spec.path("range");
        if (!range.isArray() || range.size() < 2) return true;
        return v >= range.get(0).asLong(Long.MIN_VALUE) && v <= range.get(1).asLong(Long.MAX_VALUE);
    }

    /**
     * §6.1.4 时间合理性。
     *
     * @param clientTsMs     客户端自报时刻
     * @param nowMs          服务端当前时刻
     * @param sessionStartMs 试玩会话创建时刻（可空：会话未提供/已清理时跳过时长检查）
     * @param minPlayMs      manifest.score.minPlayMs（有效提交最短时长）
     * @return null=通过；否则拒绝原因（中文，进错误封套）
     */
    public static String checkTime(long clientTsMs, long nowMs, Long sessionStartMs, long minPlayMs) {
        if (clientTsMs < nowMs - CLIENT_TS_MIN_AGE_MS) return "clientTs 过早（早于 5 分钟前）";
        if (clientTsMs > nowMs + CLIENT_TS_MAX_FUTURE_MS) return "clientTs 过晚（晚于 2 分钟后）";
        if (sessionStartMs != null && (nowMs - sessionStartMs) < minPlayMs) {
            return "游戏时长不足（最短 " + (minPlayMs / 1000) + " 秒）";
        }
        return null;
    }

    /** §6.1.5 异常检测：单局分超全服 P99×5 → flagged（不进榜，进人工复核）。 */
    public static boolean isAnomalous(long score, long p99) {
        return p99 > 0 && score > p99 * ANOMALY_P99_MULT;
    }

    /** 从最近一批 ok 分数算 P99（纯函数；空批 → 0 = 无法判定，不 flag）。 */
    public static long p99(List<Long> scores) {
        if (scores == null || scores.isEmpty()) return 0;
        List<Long> sorted = new ArrayList<>(scores);
        sorted.sort(Long::compare);
        int idx = (int) Math.ceil(sorted.size() * 0.99) - 1;
        return sorted.get(Math.max(0, Math.min(idx, sorted.size() - 1)));
    }
}
