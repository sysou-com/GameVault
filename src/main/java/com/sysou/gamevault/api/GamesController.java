package com.sysou.gamevault.api;

import com.sysou.gamevault.catalog.CatalogApi;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/** 公开 API（01 文档 §5.1）：目录 + 详情，匿名可访问。 */
@RestController
@RequestMapping("/api")
public class GamesController {

    private final CatalogApi catalog;

    public GamesController(CatalogApi catalog) {
        this.catalog = catalog;
    }

    @GetMapping("/games")
    public List<CatalogApi.GameCard> list() {
        return catalog.listLive();
    }

    @GetMapping("/games/{slug}")
    public CatalogApi.GameDetail detail(@PathVariable String slug) {
        return catalog.detail(slug);
    }

    @GetMapping("/health")
    public Map<String, Object> health() {
        return Map.of("service", "gamevault", "ok", true);
    }
}
