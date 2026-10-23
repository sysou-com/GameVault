package com.sysou.gamevault.achievement.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;

/** 成就解锁记录（01 文档 §3 achievement_grant；同用户同成就唯一）。 */
@Entity
@Table(name = "achievement_grant")
public class AchievementGrant {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** 中心账号 UUID（JWT sub）。 */
    @Column(name = "user_id", nullable = false)
    private String userId;

    @Column(name = "game_slug", nullable = false)
    private String gameSlug;

    @Column(name = "achievement_id", nullable = false)
    private Long achievementId;

    @Column(name = "granted_at", nullable = false)
    private Instant grantedAt = Instant.now();

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public String getUserId() { return userId; }
    public void setUserId(String userId) { this.userId = userId; }
    public String getGameSlug() { return gameSlug; }
    public void setGameSlug(String gameSlug) { this.gameSlug = gameSlug; }
    public Long getAchievementId() { return achievementId; }
    public void setAchievementId(Long achievementId) { this.achievementId = achievementId; }
    public Instant getGrantedAt() { return grantedAt; }
    public void setGrantedAt(Instant grantedAt) { this.grantedAt = grantedAt; }
}
