package com.sysou.gamevault.achievement.repo;

import com.sysou.gamevault.achievement.entity.AchievementGrant;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface AchievementGrantRepository extends JpaRepository<AchievementGrant, Long> {

    boolean existsByUserIdAndAchievementId(String userId, Long achievementId);

    @Query("""
            select g from AchievementGrant g
            where g.userId = :userId and g.gameSlug = :slug
              and g.achievementId in (select d.id from AchievementDef d where d.gameSlug = :slug)
            order by g.grantedAt desc
            """)
    List<AchievementGrant> findUserGameGrants(@Param("userId") String userId, @Param("slug") String slug);
}
