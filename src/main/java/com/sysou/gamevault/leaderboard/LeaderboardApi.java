package com.sysou.gamevault.leaderboard;

import com.fasterxml.jackson.databind.JsonNode;

import java.time.Instant;
import java.util.List;
import java.util.Map;

/**
 * leaderboard 模块对外 API（模块化纪律：跨模块只走接口）。
 * 依赖方向：leaderboard → catalog / achievement / common；api / admin → leaderboard。
 *
 * <p>提交路径只写 Redis（ZSET 榜 + pending 落库队列，01 §2.1/§6.1），SCORE_SETTLE Job 异步落
 * user_score 表——API P95 ≤ 100ms 预算（01 §9）。
 */
public interface LeaderboardApi {

    /**
     * 分数提交（01 §5.2 POST /api/scores；校验链：限流 → schema → 时间 → 异常 → 落榜/复核）。
     *
     * @param userId   中心账号 UUID（JWT sub，AuthFilter 已验签）
     * @param userName 展示名（JWT email；榜单展示用）
     * @throws com.sysou.gamevault.common.api.ApiException 429 限流 / 400 校验拒绝 / 404 游戏不存在
     */
    SubmitResult submit(String userId, String userName, SubmitRequest req);

    /** 榜单 Top-N（01 §5.1 GET /api/games/{slug}/leaderboard）。 */
    BoardView board(String slug, String scope, int limit, String myUserId);

    /** 首页卡片 Top-N（01 §5.1 GameCard 含 Top3；api 模块组合，避免 catalog→leaderboard 反向依赖）。 */
    Map<String, List<BoardEntry>> topScores(List<String> slugs, int n);

    /** 我的历史提交（01 §5.2 GET /api/me/scores）。 */
    List<ScoreRow> myScores(String userId, String gameSlug, int limit);

    /** flagged 复核队列（01 §6.1.5；管理台）。 */
    List<FlaggedRow> flaggedScores(String gameSlug, int limit);

    /**
     * 人工复核裁决（管理台）：approve=true → 补进总榜/周榜（status=ok）；
     * false → 维持榜外（reject_reason=admin_rejected）。
     */
    void resolveFlagged(Long scoreId, boolean approve);

    record SubmitRequest(String gameSlug, Long score, JsonNode meta, Long clientTs,
                         String idempotencyKey, String playSessionId) {
    }

    /** status: ok | flagged；rank 仅 ok 有值（flagged 榜外）。 */
    record SubmitResult(String status, Long rank, Long score, List<String> unlocked, String note) {
    }

    record BoardEntry(int rank, String userId, String userName, long score, JsonNode meta, Instant updatedAt) {
    }

    /** entries=Top-N；myRank/myScore 仅登录请求有值（匿名 null）。 */
    record BoardView(List<BoardEntry> entries, Integer myRank, Long myScore) {
    }

    record ScoreRow(Long id, long score, JsonNode meta, Instant clientTs, Instant submittedAt,
                    String status, String rejectReason) {
    }

    record FlaggedRow(Long id, String userId, String userName, long score, JsonNode meta,
                      Instant submittedAt, String rejectReason) {
    }
}
