package com.sysou.gamevault.achievement;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/** 成就规则求值器测试（01 文档 §6.2 声明式规则；服务端判定）。 */
class AchievementRulesTest {

    private static final ObjectMapper M = new ObjectMapper();

    private JsonNode json(String raw) throws Exception {
        return M.readTree(raw);
    }

    @Test
    void scoreGte() throws Exception {
        JsonNode rule = json("{\"type\":\"score_gte\",\"value\":10000}");
        assertTrue(AchievementRules.matches(rule, 10000, M.createObjectNode()));
        assertTrue(AchievementRules.matches(rule, 99999, M.createObjectNode()));
        assertFalse(AchievementRules.matches(rule, 9999, M.createObjectNode()));
    }

    @Test
    void comboGteUsesMetaField() throws Exception {
        JsonNode rule = json("{\"type\":\"combo_gte\",\"field\":\"bestCombo\",\"value\":30}");
        assertTrue(AchievementRules.matches(rule, 0, json("{\"bestCombo\":30}")));
        assertTrue(AchievementRules.matches(rule, 0, json("{\"bestCombo\":99}")));
        assertFalse(AchievementRules.matches(rule, 0, json("{\"bestCombo\":29}")));
        assertFalse(AchievementRules.matches(rule, 0, json("{}")));
        // 缺省 field = combo
        JsonNode defRule = json("{\"type\":\"combo_gte\",\"value\":5}");
        assertTrue(AchievementRules.matches(defRule, 0, json("{\"combo\":5}")));
        assertFalse(AchievementRules.matches(defRule, 0, json("{\"bestCombo\":5}")));
    }

    @Test
    void gameOverMetaSubset() throws Exception {
        JsonNode rule = json("{\"type\":\"game_over\",\"meta\":{\"clear\":true}}");
        assertTrue(AchievementRules.matches(rule, 0, json("{\"clear\":true}")));
        // 额外字段不影响（子集匹配）
        assertTrue(AchievementRules.matches(rule, 0, json("{\"clear\":true,\"waves\":3}")));
        assertFalse(AchievementRules.matches(rule, 0, json("{\"clear\":false}")));
        assertFalse(AchievementRules.matches(rule, 0, json("{}")));
        // 无 meta 约束 = 任意完成一局
        JsonNode anyRule = json("{\"type\":\"game_over\"}");
        assertTrue(AchievementRules.matches(anyRule, 0, json("{}")));
        assertTrue(AchievementRules.matches(anyRule, 0, M.createObjectNode()));
    }

    @Test
    void unknownTypeNeverMatches() throws Exception {
        assertFalse(AchievementRules.matches(json("{\"type\":\"fly_to_moon\"}"), 999999, json("{}")));
        assertFalse(AchievementRules.matches(M.createObjectNode(), 999999, json("{}")));
        assertFalse(AchievementRules.matches(null, 999999, json("{}")));
    }

    @Test
    void knownTypeChecks() throws Exception {
        assertTrue(AchievementRules.knownType(json("{\"type\":\"score_gte\"}")));
        assertTrue(AchievementRules.knownType(json("{\"type\":\"game_over\"}")));
        assertFalse(AchievementRules.knownType(json("{\"type\":\"whatever\"}")));
    }
}
