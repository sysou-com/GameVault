package com.sysou.gamevault.catalog;

import com.sysou.gamevault.catalog.entity.Game;
import com.sysou.gamevault.catalog.entity.GameVersion;
import com.sysou.gamevault.catalog.repo.GameRepository;
import com.sysou.gamevault.catalog.repo.GameVersionRepository;
import com.sysou.gamevault.common.api.ApiException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

/**
 * 游戏目录（01 文档 §5.1 公开 API 的数据源）。
 * M1 直查库；目录缓存（Redis 10min）M2 随榜单一起加（数据量极小，M1 无必要）。
 */
@Service
public class CatalogService implements CatalogApi {

    private final GameRepository games;
    private final GameVersionRepository versions;

    public CatalogService(GameRepository games, GameVersionRepository versions) {
        this.games = games;
        this.versions = versions;
    }

    /** 目录（仅 live 游戏，含 live 版本信息）。 */
    @Transactional(readOnly = true)
    public List<GameCard> listLive() {
        return games.findByStatusOrderBySortOrderAscIdAsc("live").stream()
                .map(g -> toCard(g, versions.findFirstByGameIdAndStatus(g.getId(), "live")))
                .toList();
    }

    /** 详情（仅 live 游戏对外可见；管理视角走 admin 模块）。 */
    @Transactional(readOnly = true)
    public GameDetail detail(String slug) {
        Game g = games.findBySlug(slug)
                .filter(x -> "live".equals(x.getStatus()))
                .orElseThrow(() -> ApiException.notFound("GAME_NOT_FOUND", "游戏不存在或未上架：" + slug));
        GameVersion v = versions.findFirstByGameIdAndStatus(g.getId(), "live")
                .orElseThrow(() -> ApiException.notFound("VERSION_NOT_FOUND", "游戏无 live 版本：" + slug));
        return new GameDetail(
                g.getSlug(), g.getTitle(), g.getSubtitle(), g.getEngine(), g.getLanguage(),
                g.getCoverUrl(), g.getDescription(), g.getTechNotesUrl(), g.getMedia(), g.getTags(),
                new LiveVersion(v.getVersion(), v.getEntryUrl(), v.getSizeBytes(), v.getPackageSha256()),
                // N0 预留（08 文档 §8）：M1–M5 恒 web 一条；M2 起填充 scores/achievements
                List.of(new Build("web", "static", v.getEntryUrl(), v.getSizeBytes(), v.getPackageSha256())),
                List.of(), List.of());
    }

    private GameCard toCard(Game g, Optional<GameVersion> v) {
        LiveVersion lv = v.map(x -> new LiveVersion(x.getVersion(), x.getEntryUrl(), x.getSizeBytes(), x.getPackageSha256()))
                .orElse(null);
        return new GameCard(g.getSlug(), g.getTitle(), g.getSubtitle(), g.getEngine(), g.getLanguage(),
                g.getCoverUrl(), g.getTags(), lv);
    }

    /**
     * 管理台上传时的登记（01 文档 §5.3）：slug 不存在则建 draft 游戏行；
     * 建 staged 版本行。事务由调用方（AdminService）管理。
     */
    @Transactional
    public void registerUpload(String slug, String title, String engine, String language,
                               String coverUrl, String manifestJson, String version,
                               String entryUrl, String sha256, long sizeBytes) {
        Game g = games.findBySlug(slug).orElseGet(() -> {
            Game ng = new Game();
            ng.setSlug(slug);
            ng.setTitle(title);
            ng.setEngine(engine);
            ng.setLanguage(language);
            ng.setCoverUrl(coverUrl);
            ng.setStatus("draft");
            return ng;
        });
        Game savedGame = games.save(g);
        GameVersion v = versions.findByGameIdAndVersion(savedGame.getId(), version)
                .orElseGet(() -> {
                    GameVersion nv = new GameVersion();
                    nv.setGameId(savedGame.getId());
                    nv.setVersion(version);
                    return nv;
                });
        v.setManifest(manifestJson);
        v.setEntryUrl(entryUrl);
        v.setPackageSha256(sha256);
        v.setSizeBytes(sizeBytes);
        v.setStatus("staged");
        v.setStatusReport(null);
        v.setPublishedAt(null);
        versions.save(v);
    }

    /** 发布：目标版本 ready/live→live，同游戏原 live→rolled_back（02 文档 §6.1 纯 DB 翻转）。 */
    @Transactional
    public GameVersion publish(Long versionId) {
        GameVersion target = versions.findById(versionId)
                .orElseThrow(() -> ApiException.notFound("VERSION_NOT_FOUND", "版本不存在：" + versionId));
        if (!"ready".equals(target.getStatus()) && !"live".equals(target.getStatus()) && !"rolled_back".equals(target.getStatus())) {
            throw ApiException.conflict("VERSION_NOT_READY", "仅 ready/live/rolled_back 版本可发布，当前：" + target.getStatus());
        }
        versions.findFirstByGameIdAndStatus(target.getGameId(), "live")
                .filter(lv -> !lv.getId().equals(target.getId()))
                .ifPresent(lv -> lv.setStatus("rolled_back"));
        target.setStatus("live");
        target.setPublishedAt(Instant.now());
        return target;
    }
}
