package com.sysou.gamevault.achievement;

import com.fasterxml.jackson.databind.JsonNode;

import java.util.List;

/**
 * achievement 模块对外 API（模块化纪律：跨模块只走接口）。
 * 依赖方向：achievement → catalog（无）；leaderboard / admin → achievement。
 */
public interface AchievementApi {

    /**
     * 发布时回写成就定义（02 文档 §3.1「发布时以包内为准并回写」）。
     * manifest 无 achievements 字段 = 不动现有定义（不清空，管理台可独立维护）。
     */
    void syncFromManifest(String gameSlug, JsonNode manifest);

    /**
     * 提分成功后同步求值（01 §6.2）：新解锁写 achievement_grant，返回本次<b>新</b>解锁的 code 列表
     * （响应体 unlocked 字段，前端弹解锁动画）。已解锁的重复命中不重发。
     */
    List<String> evaluateAndGrant(String userId, String gameSlug, long score, JsonNode meta);

    /** 成就定义（详情页侧栏展示；01 §5.1）。 */
    List<DefView> defs(String gameSlug);

    /** 我的成就（01 §5.2 GET /api/me/achievements）。 */
    List<GrantView> myGrants(String userId, String gameSlug);

    record DefView(Long id, String code, String title, String description, JsonNode rule, String iconUrl) {
    }

    record GrantView(String code, String title, String description, String iconUrl, java.time.Instant grantedAt) {
    }
}
