package com.sysou.gamevault.api;

import com.fasterxml.jackson.databind.JsonNode;
import com.sysou.gamevault.achievement.AchievementApi;
import com.sysou.gamevault.common.api.ApiException;
import com.sysou.gamevault.leaderboard.LeaderboardApi;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import jakarta.servlet.http.HttpServletRequest;
import java.util.List;

/**
 * 登录态 API（01 文档 §5.2，M2）：提分 + 我的分数/成就 + 登录态查询。
 *
 * <p>登录红线：AuthFilter 对 /api/scores 与 /api/me/** 硬 401（无有效中心 JWT 不放行）；
 * 本层再取一次已验签身份做纵深（双保险，防过滤器配置漂移）。
 */
@RestController
public class ScoreController {

    private final LeaderboardApi leaderboard;
    private final AchievementApi achievements;

    public ScoreController(LeaderboardApi leaderboard, AchievementApi achievements) {
        this.leaderboard = leaderboard;
        this.achievements = achievements;
    }

    record ScoreSubmitBody(String gameSlug, Long score, JsonNode meta, Long clientTs,
                           String idempotencyKey, String playSessionId) {
    }

    public record ScoreSubmitResponse(String status, Long rank, Long score, List<String> unlocked, String note) {
    }

    public record MeResponse(String id, String email, List<String> roles, boolean platformAdmin) {
    }

    /** POST /api/scores（01 §5.2）：限流 20/10min（ScoreService）+ 幂等键（重复 → 200 原结果）。 */
    @PostMapping("/api/scores")
    public ScoreSubmitResponse submit(@RequestBody ScoreSubmitBody b, HttpServletRequest req) {
        JwtVerifier.VerifiedToken t = requireLogin(req);
        LeaderboardApi.SubmitResult r = leaderboard.submit(t.sub(), t.email(),
                new LeaderboardApi.SubmitRequest(b.gameSlug(), b.score(), b.meta(), b.clientTs(),
                        b.idempotencyKey(), b.playSessionId()));
        return new ScoreSubmitResponse(r.status(), r.rank(), r.score(), r.unlocked(), r.note());
    }

    /** GET /api/me：前端登录态展示（后端验签后的身份，非前端自解析）。 */
    @GetMapping("/api/me")
    public MeResponse me(HttpServletRequest req) {
        JwtVerifier.VerifiedToken t = requireLogin(req);
        return new MeResponse(t.sub(), t.email(), t.roles(), t.platformAdmin());
    }

    /** GET /api/me/scores?gameSlug=（01 §5.2）。 */
    @GetMapping("/api/me/scores")
    public List<LeaderboardApi.ScoreRow> myScores(@RequestParam String gameSlug, HttpServletRequest req) {
        JwtVerifier.VerifiedToken t = requireLogin(req);
        return leaderboard.myScores(t.sub(), gameSlug, 20);
    }

    /** GET /api/me/achievements?gameSlug=（01 §5.2）。 */
    @GetMapping("/api/me/achievements")
    public List<AchievementApi.GrantView> myAchievements(@RequestParam String gameSlug, HttpServletRequest req) {
        JwtVerifier.VerifiedToken t = requireLogin(req);
        return achievements.myGrants(t.sub(), gameSlug);
    }

    private JwtVerifier.VerifiedToken requireLogin(HttpServletRequest req) {
        JwtVerifier.VerifiedToken t = AuthFilter.current(req);
        if (t == null) {
            throw ApiException.unauthorized("UNAUTHORIZED", "需要登录（中心令牌缺失或无效）");
        }
        return t;
    }
}
