package com.sysou.gamevault.achievement;

import com.fasterxml.jackson.databind.JsonNode;

import java.util.Iterator;
import java.util.Map;

/**
 * 成就规则求值器（01 文档 §6.2：服务端判定，客户端不可自报）。
 *
 * <p>纯函数、无 IO——单测直接覆盖。支持规则（声明式，manifest.achievements[].rule）：
 * <ul>
 *   <li>{"type":"score_gte","value":10000} —— 本局分数 ≥ value</li>
 *   <li>{"type":"combo_gte","value":30,"field":"bestCombo"} —— meta[field]（缺省 "combo"）≥ value</li>
 *   <li>{"type":"game_over","meta":{"clear":true}} —— meta 须包含 rule.meta 全部键值（子集匹配）；
 *       无 meta 约束 = 任意完成一局</li>
 * </ul>
 * 未知 type 恒 false（同步时告警），避免误发。
 */
public final class AchievementRules {

    private AchievementRules() {
    }

    public static boolean matches(JsonNode rule, long score, JsonNode meta) {
        if (rule == null || rule.isMissingNode() || rule.isNull()) return false;
        String type = rule.path("type").asText("");
        return switch (type) {
            case "score_gte" -> score >= rule.path("value").asLong(-1);
            case "combo_gte" -> metaIntegral(meta, rule.path("field").asText("combo"))
                    >= rule.path("value").asLong(-1);
            case "game_over" -> metaSubsetMatches(meta, rule.path("meta"));
            default -> false;
        };
    }

    public static boolean knownType(JsonNode rule) {
        if (rule == null || rule.isMissingNode()) return false;
        return switch (rule.path("type").asText("")) {
            case "score_gte", "combo_gte", "game_over" -> true;
            default -> false;
        };
    }

    private static long metaIntegral(JsonNode meta, String field) {
        JsonNode v = meta == null || !meta.isObject() ? null : meta.get(field);
        return v != null && v.isIntegralNumber() ? v.asLong() : -1;
    }

    private static boolean metaSubsetMatches(JsonNode meta, JsonNode want) {
        if (want == null || want.isMissingNode() || want.isNull() || !want.isObject()) {
            return true; // 无 meta 约束 = 任意完成
        }
        if (meta == null || !meta.isObject()) return false;
        for (Map.Entry<String, JsonNode> e : entries(want)) {
            JsonNode actual = meta.get(e.getKey());
            if (actual == null || !actual.equals(e.getValue())) return false;
        }
        return true;
    }

    private static java.util.List<Map.Entry<String, JsonNode>> entries(JsonNode node) {
        java.util.List<Map.Entry<String, JsonNode>> out = new java.util.ArrayList<>();
        for (Iterator<Map.Entry<String, JsonNode>> it = node.fields(); it.hasNext(); ) {
            out.add(it.next());
        }
        return out;
    }
}
