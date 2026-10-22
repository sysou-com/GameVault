package com.sysou.gamevault.catalog.entity;

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
 * 游戏版本（M1 隐式 = web 构建；N1 起拆 game_build 载体表，08 文档 §3）。
 * status: staged → ready → live / rolled_back；staged → failed（校验不过）。
 */
@Entity
@Table(name = "game_version")
public class GameVersion {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "game_id", nullable = false)
    private Long gameId;

    @Column(nullable = false)
    private String version;

    /** 冻结的 manifest.json 原文（02 文档 §3.1）。 */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb", nullable = false)
    private String manifest = "{}";

    @Column(name = "entry_url", nullable = false)
    private String entryUrl;

    @Column(name = "package_sha256", nullable = false)
    private String packageSha256 = "";

    @Column(name = "size_bytes", nullable = false)
    private long sizeBytes;

    @Column(nullable = false)
    private String status = "staged";

    /** 校验/处理报告（02 文档 §6 报告逐项）。 */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "status_report", columnDefinition = "jsonb")
    private String statusReport;

    @Column(name = "published_at")
    private Instant publishedAt;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt = Instant.now();

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getGameId() { return gameId; }
    public void setGameId(Long gameId) { this.gameId = gameId; }
    public String getVersion() { return version; }
    public void setVersion(String version) { this.version = version; }
    public String getManifest() { return manifest; }
    public void setManifest(String manifest) { this.manifest = manifest; }
    public String getEntryUrl() { return entryUrl; }
    public void setEntryUrl(String entryUrl) { this.entryUrl = entryUrl; }
    public String getPackageSha256() { return packageSha256; }
    public void setPackageSha256(String sha) { this.packageSha256 = sha; }
    public long getSizeBytes() { return sizeBytes; }
    public void setSizeBytes(long size) { this.sizeBytes = size; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public String getStatusReport() { return statusReport; }
    public void setStatusReport(String report) { this.statusReport = report; }
    public Instant getPublishedAt() { return publishedAt; }
    public void setPublishedAt(Instant publishedAt) { this.publishedAt = publishedAt; }
    public Instant getCreatedAt() { return createdAt; }
}
