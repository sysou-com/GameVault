package com.sysou.gamevault.api;

import com.sysou.gamevault.achievement.AchievementApi;
import com.sysou.gamevault.catalog.CatalogApi;
import com.sysou.gamevault.common.api.ApiException;
import com.sysou.gamevault.leaderboard.LeaderboardApi;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.Map;

/** 公开 API（01 文档 §5.1）：目录 + 详情 + 榜单，匿名可访问。 */
@RestController
@RequestMapping("/api")
public class GamesController {

    private final CatalogApi catalog;
    private final LeaderboardApi leaderboard;
    private final AchievementApi achievements;

    public GamesController(CatalogApi catalog, LeaderboardApi leaderboard, AchievementApi achievements) {
        this.catalog = catalog;
        this.leaderboard = leaderboard;
        this.achievements = achievements;
    }

    /**
     * 目录（01 §5.1：含 live 版本 + Top3 分数）。
     * 组合在 api 模块完成：catalog 不依赖 leaderboard（模块化方向 leaderboard → catalog）。
     */
    @GetMapping("/games")
    public List<GameCardWithBoard> list() {
        List<CatalogApi.GameCard> cards = catalog.listLive();
        Map<String, List<LeaderboardApi.BoardEntry>> tops =
                leaderboard.topScores(cards.stream().map(CatalogApi.GameCard::slug).toList(), 3);
        return cards.stream()
                .map(c -> new GameCardWithBoard(c.slug(), c.title(), c.subtitle(), c.engine(), c.language(),
                        c.coverUrl(), c.tags(), c.liveVersion(), tops.getOrDefault(c.slug(), List.of())))
                .toList();
    }

    /** 详情（01 §5.1：含 liveVersion.entryUrl、Top10、成就定义、builds[] N0 预留）。 */
    @GetMapping("/games/{slug}")
    public CatalogApi.GameDetail detail(@PathVariable String slug) {
        CatalogApi.GameDetail d = catalog.detail(slug);
        List<LeaderboardApi.BoardEntry> top10 = leaderboard.board(slug, "all", 10, null).entries();
        List<Object> scores = top10.stream().map(e -> (Object) e).toList();
        List<Object> achievementsList = achievements.defs(slug).stream().map(a -> (Object) a).toList();
        return new CatalogApi.GameDetail(d.slug(), d.title(), d.subtitle(), d.engine(), d.language(),
                d.coverUrl(), d.description(), d.techNotesUrl(), d.media(), d.tags(), d.liveVersion(),
                d.builds(), scores, achievementsList);
    }

    /**
     * 榜单 Top100（01 §5.1；scope=all|week）。登录请求附 myRank/myScore（匿名 null）；
     * M2 起榜单只收登录分（游客分不存在，榜外无「游客」行）。
     */
    @GetMapping("/games/{slug}/leaderboard")
    public LeaderboardApi.BoardView leaderboard(@PathVariable String slug,
                                                @RequestParam(defaultValue = "all") String scope,
                                                HttpServletRequest req) {
        if (!"all".equals(scope) && !"week".equals(scope)) {
            throw ApiException.badRequest("BAD_SCOPE", "scope 必须是 all 或 week");
        }
        JwtVerifier.VerifiedToken t = AuthFilter.current(req);
        return leaderboard.board(slug, scope, 100, t == null ? null : t.sub());
    }

    @GetMapping("/health")
    public Map<String, Object> health() {
        return Map.of("service", "gamevault", "ok", true);
    }

    /** 目录卡片 + Top3（01 §5.1；api 模块组合视图，JSON 字段与 M1 GameCard 兼容 + topScores 增量）。 */
    public record GameCardWithBoard(String slug, String title, String subtitle, String engine, String language,
                                    String coverUrl, String[] tags, CatalogApi.LiveVersion liveVersion,
                                    List<LeaderboardApi.BoardEntry> topScores) {
    }
}
