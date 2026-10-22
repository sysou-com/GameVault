package com.sysou.gamevault.catalog.repo;

import com.sysou.gamevault.catalog.entity.Game;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface GameRepository extends JpaRepository<Game, Long> {

    Optional<Game> findBySlug(String slug);

    List<Game> findByStatusOrderBySortOrderAscIdAsc(String status);

    @Query("select g from Game g where g.status = :status")
    List<Game> findAllByStatus(@Param("status") String status);
}
