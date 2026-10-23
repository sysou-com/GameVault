package com.sysou.gamevault.leaderboard;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/** 提分校验链纯函数测试（01 文档 §10：校验链纯函数化）。 */
class ScoreValidatorTest {

    private static final ObjectMapper M = new ObjectMapper();

    private JsonNode json(String raw) throws Exception {
        return M.readTree(raw);
    }

    @Test
    void scoreBounds() {
        assertTrue(ScoreValidator.inBounds(0, 0, 999_999));
        assertTrue(ScoreValidator.inBounds(999_999, 0, 999_999));
        assertFalse(ScoreValidator.inBounds(-1, 0, 999_999));
        assertFalse(ScoreValidator.inBounds(1_000_000, 0, 999_999));
    }

    @Test
    void metaUnknownFieldsDroppedWithWarning() throws Exception {
        JsonNode schema = json("{\"bestCombo\":{\"type\":\"int\",\"range\":[0,9999]}}");
        JsonNode meta = json("{\"bestCombo\":12,\"cheat\":\"yes\"}");
        ScoreValidator.MetaResult r = ScoreValidator.validateMeta(meta, schema);
        assertEquals(12, r.meta().path("bestCombo").asInt());
        assertFalse(r.meta().has("cheat"));
        assertEquals(1, r.warnings().size());
        assertTrue(r.warnings().get(0).contains("cheat"));
    }

    @Test
    void metaTypeAndRangeEnforced() throws Exception {
        JsonNode schema = json("{\"bestCombo\":{\"type\":\"int\",\"range\":[0,99]}}");
        var r1 = ScoreValidator.validateMeta(json("{\"bestCombo\":\"12\"}"), schema);
        assertFalse(r1.meta().has("bestCombo")); // 非整数丢弃
        var r2 = ScoreValidator.validateMeta(json("{\"bestCombo\":120}"), schema);
        assertFalse(r2.meta().has("bestCombo")); // 超区间丢弃
        var r3 = ScoreValidator.validateMeta(json("{\"bestCombo\":12}"), schema);
        assertEquals(12, r3.meta().path("bestCombo").asInt());
    }

    @Test
    void metaWithoutSchemaKeptAsIs() throws Exception {
        JsonNode meta = json("{\"a\":1}");
        ScoreValidator.MetaResult r = ScoreValidator.validateMeta(meta, null);
        assertEquals(1, r.meta().path("a").asInt());
        assertTrue(r.warnings().isEmpty());
    }

    @Test
    void nullMetaBecomesEmptyObject() {
        ScoreValidator.MetaResult r = ScoreValidator.validateMeta(null, null);
        assertTrue(r.meta().isObject());
        assertTrue(r.meta().isEmpty());
    }

    @Test
    void timeWindowChecks() {
        long now = 1_000_000_000_000L;
        // 正常：clientTs = now - 1min
        assertNull(ScoreValidator.checkTime(now - 60_000, now, null, 3000));
        // clientTs 过早（>5min）
        assertNotNull(ScoreValidator.checkTime(now - 6 * 60_000, now, null, 3000));
        // clientTs 过晚（>2min 未来）
        assertNotNull(ScoreValidator.checkTime(now + 3 * 60_000, now, null, 3000));
        // 边界内：now - 4min / now + 1min 放行
        assertNull(ScoreValidator.checkTime(now - 4 * 60_000, now, null, 3000));
        assertNull(ScoreValidator.checkTime(now + 60_000, now, null, 3000));
    }

    @Test
    void minPlayMsEnforcedWhenSessionKnown() {
        long now = 1_000_000_000_000L;
        // 会话仅进行 1s < minPlay 3s → 拒绝
        assertNotNull(ScoreValidator.checkTime(now, now, now - 1_000, 3_000));
        // 会话进行 10s → 放行
        assertNull(ScoreValidator.checkTime(now, now, now - 10_000, 3_000));
        // 会话未知（null）→ 跳过时长检查（M1 简化）
        assertNull(ScoreValidator.checkTime(now, now, null, 3_000));
    }

    @Test
    void anomalyDetectionP99x5() {
        assertFalse(ScoreValidator.isAnomalous(100, 0));        // 无 P99 数据 → 不 flag
        assertFalse(ScoreValidator.isAnomalous(49, 10));       // = P99×4.9 不 flag
        assertTrue(ScoreValidator.isAnomalous(51, 10));        // > P99×5 flag
        assertFalse(ScoreValidator.isAnomalous(10, 100));
    }

    @Test
    void p99Computation() {
        assertEquals(0, ScoreValidator.p99(List.of()));
        assertEquals(10, ScoreValidator.p99(List.of(10L)));
        assertEquals(990, ScoreValidator.p99(intRange(1, 1000)));   // 1..1000 → P99 = 990
        assertEquals(9, ScoreValidator.p99(List.of(5L, 1L, 9L, 3L)));   // 小批：idx=ceil(4×0.99)-1=3 → 第4小（9）
    }

    private static List<Long> intRange(int lo, int hi) {
        java.util.ArrayList<Long> out = new java.util.ArrayList<>();
        for (int i = lo; i <= hi; i++) out.add((long) i);
        return out;
    }
}
