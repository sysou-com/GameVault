package com.sysou.gamevault.catalog;

import com.sysou.gamevault.catalog.entity.Game;
import com.sysou.gamevault.catalog.entity.GameVersion;
import com.sysou.gamevault.catalog.repo.GameRepository;
import com.sysou.gamevault.catalog.repo.GameVersionRepository;
import com.sysou.gamevault.common.api.ApiException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/** 目录/发布状态机单测（01 文档 §5.3 发布语义：版本×构建翻转）。 */
@ExtendWith(MockitoExtension.class)
class CatalogServiceTest {

    @Mock
    GameRepository games;
    @Mock
    GameVersionRepository versions;

    CatalogService service;

    Game game;
    GameVersion live;
    GameVersion ready;

    @BeforeEach
    void setUp() {
        service = new CatalogService(games, versions);
        game = new Game();
        game.setId(1L);
        game.setSlug("neon-raid");
        game.setTitle("霓虹突袭");
        game.setEngine("phaser-4");
        game.setLanguage("typescript");
        game.setCoverUrl("/game/g/neon-raid/cover.png");
        game.setStatus("live");

        live = new GameVersion();
        live.setId(10L);
        live.setGameId(1L);
        live.setVersion("1.0.0");
        live.setEntryUrl("/game/g/neon-raid/1.0.0/index.html");
        live.setStatus("live");
        live.setSizeBytes(42);

        ready = new GameVersion();
        ready.setId(11L);
        ready.setGameId(1L);
        ready.setVersion("1.1.0");
        ready.setEntryUrl("/game/g/neon-raid/1.1.0/index.html");
        ready.setStatus("ready");
        ready.setSizeBytes(43);
    }

    @Test
    void listLiveIncludesCardWithLiveVersion() {
        when(games.findByStatusOrderBySortOrderAscIdAsc("live")).thenReturn(List.of(game));
        when(versions.findFirstByGameIdAndStatus(1L, "live")).thenReturn(Optional.of(live));

        List<CatalogApi.GameCard> cards = service.listLive();

        assertEquals(1, cards.size());
        assertEquals("neon-raid", cards.get(0).slug());
        assertEquals("1.0.0", cards.get(0).liveVersion().version());
    }

    @Test
    void detailReturns404WhenNotLive() {
        when(games.findBySlug("ghost")).thenReturn(Optional.empty());
        ApiException e = assertThrows(ApiException.class, () -> service.detail("ghost"));
        assertEquals("GAME_NOT_FOUND", e.code());
    }

    @Test
    void detailIncludesWebBuildEntry() {
        when(games.findBySlug("neon-raid")).thenReturn(Optional.of(game));
        when(versions.findFirstByGameIdAndStatus(1L, "live")).thenReturn(Optional.of(live));

        CatalogApi.GameDetail d = service.detail("neon-raid");

        assertEquals(1, d.builds().size());
        assertEquals("web", d.builds().get(0).platform());
        assertEquals("static", d.builds().get(0).type());
    }

    @Test
    void publishFlipsOldLiveToRolledBack() {
        when(versions.findById(11L)).thenReturn(Optional.of(ready));
        when(versions.findFirstByGameIdAndStatus(1L, "live")).thenReturn(Optional.of(live));

        GameVersion published = service.publish(11L);

        assertEquals("live", published.getStatus());
        assertNotNull(published.getPublishedAt());
        assertEquals("rolled_back", live.getStatus());
    }

    @Test
    void publishRejectsStagedVersion() {
        ready.setStatus("staged");
        when(versions.findById(11L)).thenReturn(Optional.of(ready));

        ApiException e = assertThrows(ApiException.class, () -> service.publish(11L));
        assertEquals("VERSION_NOT_READY", e.code());
    }

    @Test
    void rollbackRepublishesRolledBackVersion() {
        ready.setStatus("rolled_back");
        when(versions.findById(11L)).thenReturn(Optional.of(ready));
        when(versions.findFirstByGameIdAndStatus(1L, "live")).thenReturn(Optional.empty());

        assertEquals("live", service.publish(11L).getStatus());
    }
}
