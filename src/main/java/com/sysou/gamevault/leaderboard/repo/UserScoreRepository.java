package com.sysou.gamevault.leaderboard.repo;

import com.sysou.gamevault.leaderboard.entity.UserScore;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface UserScoreRepository extends JpaRepository<UserScore, Long> {

    /** P99 异常检测（01 §6.1.5）：最近 1000 条 ok 分（按提交时间倒序）。 */
    List<UserScore> findTop1000ByGameSlugAndStatusOrderBySubmittedAtDesc(String gameSlug, String status);

    /** flagged 复核队列（管理台，01 §6.1.5）。 */
    List<UserScore> findTop200ByGameSlugAndStatusOrderBySubmittedAtDesc(String gameSlug, String status);

    Page<UserScore> findByUserIdAndGameSlugOrderBySubmittedAtDesc(String userId, String gameSlug, Pageable pageable);
}
