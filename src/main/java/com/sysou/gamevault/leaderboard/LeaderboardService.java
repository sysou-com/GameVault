package com.sysou.gamevault.leaderboard;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sysou.gamevault.catalog.CatalogApi;
import com.sysou.gamevault.common.api.ApiException;
import com.sysou.gamevault.leaderboard.entity.UserScore;
import com.sysou.gamevault.leaderboard.repo.UserScoreRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ZSetOperations;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 榜单读取（01 §5.1/§9：ZSET ZREVRANGE，≤50ms）+ 我的分数/flagged 复核查询。
 */
@Service
public class LeaderboardService {

    private static final Logger log = LoggerFactory.getLogger(LeaderboardService.class);

    private final CatalogApi catalog;
    private final UserScoreRepository scores;
    private final StringRedisTemplate redis;
    private final ObjectMapper mapper;

    public LeaderboardService(CatalogApi catalog, UserScoreRepository scores,
                              StringRedisTemplate redis, ObjectMapper mapper) {
        this.catalog = catalog;
        this.scores = scores;
        this.redis = redis;
        this.mapper = mapper;
    }

    public LeaderboardApi.BoardView board(String slug, String scope, int limit, String myUserId) {
        ScoreSpec spec = ScoreSpec.fromManifest(catalog.liveManifest(slug));
        String key = "lb:week".equals(scope)
                ? "lb:week:" + slug + ":" + WeekKey.current(Instant.now())
                : "lb:all:" + slug;
        List<LeaderboardApi.BoardEntry> entries = new ArrayList<>();
        Set<ZSetOperations.TypedTuple<String>> ranged = redis.opsForZSet().reverseRangeWithScores(key, 0, limit - 1);
        if (ranged != null) {
            int rank = 1;
            for (ZSetOperations.TypedTuple<String> e : ranged) {
                String uid = e.getValue();
                long stored = e.getScore().longValue();
                long score = spec.higherIsBetter() ? stored : -stored;
                entries.add(new LeaderboardApi.BoardEntry(rank, uid, name(uid), score, lastMeta(slug, uid), lastAt(slug, uid)));
                rank++;
            }
        }
        Integer myRank = null;
        Long myScore = null;
        if (myUserId != null) {
            Long r = redis.opsForZSet().reverseRank(key, myUserId);
            if (r != null) {
                myRank = r.intValue() + 1;
                Double s = redis.opsForZSet().score(key, myUserId);
                myScore = s == null ? null : (spec.higherIsBetter() ? s.longValue() : -s.longValue());
            }
        }
        return new LeaderboardApi.BoardView(entries, myRank, myScore);
    }

    public Map<String, List<LeaderboardApi.BoardEntry>> topScores(List<String> slugs, int n) {
        Map<String, List<LeaderboardApi.BoardEntry>> out = new LinkedHashMap<>();
        for (String slug : slugs) {
            try {
                out.put(slug, board(slug, "all", n, null).entries());
            } catch (ApiException e) {
                out.put(slug, List.of()); // 卡片不因榜单异常丢整卡
            }
        }
        return out;
    }

    @Transactional(readOnly = true)
    public List<LeaderboardApi.ScoreRow> myScores(String userId, String gameSlug, int limit) {
        return scores.findByUserIdAndGameSlugOrderBySubmittedAtDesc(userId, gameSlug, PageRequest.of(0, limit))
                .getContent().stream().map(this::row).toList();
    }

    @Transactional(readOnly = true)
    public List<LeaderboardApi.FlaggedRow> flaggedScores(String gameSlug, int limit) {
        return scores.findTop200ByGameSlugAndStatusOrderBySubmittedAtDesc(gameSlug, "flagged")
                .stream().limit(limit).map(u -> new LeaderboardApi.FlaggedRow(
                        u.getId(), u.getUserId(), name(u.getUserId()), u.getScore(), json(u.getMeta()),
                        u.getSubmittedAt(), u.getRejectReason()))
                .toList();
    }

    private LeaderboardApi.ScoreRow row(UserScore u) {
        return new LeaderboardApi.ScoreRow(u.getId(), u.getScore(), json(u.getMeta()),
                u.getClientTs(), u.getSubmittedAt(), u.getStatus(), u.getRejectReason());
    }

    private String name(String userId) {
        String n = redis.opsForValue().get("lb:name:" + userId);
        return (n == null || n.isBlank()) ? "游客" : n;
    }

    private JsonNode lastMeta(String slug, String userId) {
        try {
            Object v = redis.opsForHash().get("lb:last:" + slug + ":" + userId, "meta");
            if (v == null) return mapper.createObjectNode();
            return mapper.readTree(String.valueOf(v));
        } catch (Exception e) {
            return mapper.createObjectNode();
        }
    }

    private Instant lastAt(String slug, String userId) {
        try {
            Object v = redis.opsForHash().get("lb:last:" + slug + ":" + userId, "at");
            return v == null ? null : Instant.parse(String.valueOf(v));
        } catch (Exception e) {
            return null;
        }
    }

    private JsonNode json(String raw) {
        try {
            return mapper.readTree(raw == null || raw.isBlank() ? "{}" : raw);
        } catch (Exception e) {
            log.warn("user_score.meta 解析失败: {}", e.toString());
            return mapper.createObjectNode();
        }
    }
}
