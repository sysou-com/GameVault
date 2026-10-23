package com.sysou.gamevault.leaderboard;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * 游戏分数规格（来自 live 版本 manifest.score，02 文档 §3.1；01 文档 §6.1 校验链输入）。
 *
 * <p>纯解析、无 IO——由 {@link LeaderboardApi} 从 {@code CatalogApi.liveManifest(slug)} 取得
 * manifest 后调用 {@link #fromManifest}，便于单测。
 */
public record ScoreSpec(boolean enabled, long min, long max, boolean higherIsBetter,
                        long minPlayMs, JsonNode metaSchema) {

    public static ScoreSpec fromManifest(JsonNode manifest) {
        JsonNode s = manifest.path("score");
        if (s.isMissingNode() || s.isNull()) {
            return new ScoreSpec(false, 0, Long.MAX_VALUE, true, 3000, null);
        }
        JsonNode range = s.path("range");
        long min = range.isArray() && range.size() >= 2 ? range.get(0).asLong(0) : 0;
        long max = range.isArray() && range.size() >= 2 ? range.get(1).asLong(Long.MAX_VALUE) : Long.MAX_VALUE;
        JsonNode metaSchema = s.path("metaSchema");
        return new ScoreSpec(
                s.path("enabled").asBoolean(true),
                min,
                max,
                s.path("higherIsBetter").asBoolean(true),
                s.path("minPlayMs").asLong(3000),
                metaSchema.isMissingNode() || metaSchema.isNull() ? null : metaSchema);
    }
}
