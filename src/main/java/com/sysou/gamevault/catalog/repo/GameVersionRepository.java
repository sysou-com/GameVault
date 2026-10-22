package com.sysou.gamevault.catalog.repo;

import com.sysou.gamevault.catalog.entity.GameVersion;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface GameVersionRepository extends JpaRepository<GameVersion, Long> {

    Optional<GameVersion> findFirstByGameIdAndStatus(Long gameId, String status);

    List<GameVersion> findByGameIdOrderByIdDesc(Long gameId);

    Optional<GameVersion> findByGameIdAndVersion(Long gameId, String version);
}
