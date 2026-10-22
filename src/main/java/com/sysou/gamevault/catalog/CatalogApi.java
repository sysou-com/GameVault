package com.sysou.gamevault.catalog;

import com.sysou.gamevault.catalog.entity.GameVersion;

import java.util.List;

/** catalog 模块对外 API（模块化纪律：跨模块只走接口）。 */
public interface CatalogApi {

    List<GameCard> listLive();

    GameDetail detail(String slug);

    void registerUpload(String slug, String title, String engine, String language,
                        String coverUrl, String manifestJson, String version,
                        String entryUrl, String sha256, long sizeBytes);

    GameVersion publish(Long versionId);

    /** 首页卡片（01 文档 §5.1 GameCard）。 */
    record GameCard(String slug, String title, String subtitle, String engine, String language,
                    String coverUrl, String[] tags, LiveVersion liveVersion) {
    }

    /** 详情页（01 文档 §5.1；scores/achievements M2 填充；builds N0 预留 08 文档 §8）。 */
    record GameDetail(String slug, String title, String subtitle, String engine, String language,
                      String coverUrl, String description, String techNotesUrl, String media,
                      String[] tags, LiveVersion liveVersion, List<Build> builds,
                      List<Object> scores, List<Object> achievements) {
    }

    record LiveVersion(String version, String entryUrl, long sizeBytes, String sha256) {
    }

    /** N0 预留（08 文档 §5.2）：M1–M5 恒 web 一条。 */
    record Build(String platform, String type, String url, long sizeBytes, String sha256) {
    }
}
