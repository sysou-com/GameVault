package com.sysou.gamevault.achievement.repo;

import com.sysou.gamevault.achievement.entity.AchievementDef;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface AchievementDefRepository extends JpaRepository<AchievementDef, Long> {

    List<AchievementDef> findByGameSlug(String gameSlug);

    Optional<AchievementDef> findByGameSlugAndCode(String gameSlug, String code);
}
