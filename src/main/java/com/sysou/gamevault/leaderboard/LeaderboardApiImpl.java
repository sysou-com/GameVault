package com.sysou.gamevault.leaderboard;

import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;

/** LeaderboardApi 实现（模块内部 ScoreService + LeaderboardService 的对外门面）。 */
@Service
public class LeaderboardApiImpl implements LeaderboardApi {

    private final ScoreService scores;
    private final LeaderboardService board;

    public LeaderboardApiImpl(ScoreService scores, LeaderboardService board) {
        this.scores = scores;
        this.board = board;
    }

    @Override
    public SubmitResult submit(String userId, String userName, SubmitRequest req) {
        return scores.submit(userId, userName, req);
    }

    @Override
    public BoardView board(String slug, String scope, int limit, String myUserId) {
        return board.board(slug, scope, Math.max(1, Math.min(limit, 100)), myUserId);
    }

    @Override
    public Map<String, List<BoardEntry>> topScores(List<String> slugs, int n) {
        return board.topScores(slugs, Math.max(1, Math.min(n, 10)));
    }

    @Override
    public List<ScoreRow> myScores(String userId, String gameSlug, int limit) {
        return board.myScores(userId, gameSlug, Math.max(1, Math.min(limit, 100)));
    }

    @Override
    public List<FlaggedRow> flaggedScores(String gameSlug, int limit) {
        return board.flaggedScores(gameSlug, Math.max(1, Math.min(limit, 100)));
    }

    @Override
    public void resolveFlagged(Long scoreId, boolean approve) {
        scores.resolveFlagged(scoreId, approve);
    }
}
