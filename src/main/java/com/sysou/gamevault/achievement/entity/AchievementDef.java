package com.sysou.gamevault.achievement.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * 成就定义（01 文档 §3 achievement_def）。
 * 定义来源：游戏包 manifest.achievements（发布时回写，02 文档 §3.1）或管理台维护。
 * rule = 声明式规则（01 §6.2）：{"type":"score_gte","value":10000} /
 * {"type":"game_over","meta":{"clear":true}} / {"type":"combo_gte","field":"bestCombo","value":30}。
 */
@Entity
@Table(name = "achievement_def")
public class AchievementDef {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "game_slug", nullable = false)
    private String gameSlug;

    @Column(nullable = false)
    private String code;

    @Column(nullable = false)
    private String title;

    @Column(nullable = false)
    private String description;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb", nullable = false)
    private String rule = "{}";

    @Column(name = "icon_url")
    private String iconUrl;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public String getGameSlug() { return gameSlug; }
    public void setGameSlug(String gameSlug) { this.gameSlug = gameSlug; }
    public String getCode() { return code; }
    public void setCode(String code) { this.code = code; }
    public String getTitle() { return title; }
    public void setTitle(String title) { this.title = title; }
    public String getDescription() { return description; }
    public void setDescription(String description) { this.description = description; }
    public String getRule() { return rule; }
    public void setRule(String rule) { this.rule = rule; }
    public String getIconUrl() { return iconUrl; }
    public void setIconUrl(String iconUrl) { this.iconUrl = iconUrl; }
}
