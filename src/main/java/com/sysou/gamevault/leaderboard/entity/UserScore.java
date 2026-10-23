package com.sysou.gamevault.leaderboard.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;

/**
 * 分数提交落库行（01 文档 §3 user_score；提交路径只写 Redis，SCORE_SETTLE Job 异步落此表）。
 * status: ok | rejected_bounds（边界/时间拒绝，审计用）| flagged（异常检测命中，人工复核）。
 */
@Entity
@Table(name = "user_score")
public class UserScore {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** 中心账号 UUID（JWT sub；sysou-manage account.id）。 */
    @Column(name = "user_id", nullable = false)
    private String userId;

    @Column(name = "game_slug", nullable = false)
    private String gameSlug;

    @Column(nullable = false)
    private long score;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb", nullable = false)
    private String meta = "{}";

    @Column(name = "client_ts", nullable = false)
    private Instant clientTs = Instant.now();

    @Column(name = "submitted_at", nullable = false)
    private Instant submittedAt = Instant.now();

    @Column(nullable = false)
    private String status = "ok";

    @Column(name = "reject_reason")
    private String rejectReason;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public String getUserId() { return userId; }
    public void setUserId(String userId) { this.userId = userId; }
    public String getGameSlug() { return gameSlug; }
    public void setGameSlug(String gameSlug) { this.gameSlug = gameSlug; }
    public long getScore() { return score; }
    public void setScore(long score) { this.score = score; }
    public String getMeta() { return meta; }
    public void setMeta(String meta) { this.meta = meta; }
    public Instant getClientTs() { return clientTs; }
    public void setClientTs(Instant clientTs) { this.clientTs = clientTs; }
    public Instant getSubmittedAt() { return submittedAt; }
    public void setSubmittedAt(Instant submittedAt) { this.submittedAt = submittedAt; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public String getRejectReason() { return rejectReason; }
    public void setRejectReason(String rejectReason) { this.rejectReason = rejectReason; }
}
