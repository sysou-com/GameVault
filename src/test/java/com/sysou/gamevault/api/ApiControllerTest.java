package com.sysou.gamevault.api;

import com.sysou.gamevault.catalog.CatalogApi;
import com.sysou.gamevault.catalog.CatalogApi.GameCard;
import com.sysou.gamevault.catalog.CatalogApi.LiveVersion;
import com.sysou.gamevault.player.PlaySessionService;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** 公开 API 契约测试（01 文档 §5：封套/404/健康探针）。 */
class ApiControllerTest {

    MockMvc mvc;
    CatalogApi catalog = mock(CatalogApi.class);
    PlaySessionService sessions = mock(PlaySessionService.class);

    void build() {
        mvc = MockMvcBuilders.standaloneSetup(
                        new GamesController(catalog),
                        new PlayController(sessions))
                .setControllerAdvice(new GlobalExceptionHandler())
                .build();
    }

    @Test
    void healthReturnsOk() throws Exception {
        build();
        mvc.perform(get("/api/health"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.service").value("gamevault"))
                .andExpect(jsonPath("$.ok").value(true));
    }

    @Test
    void gamesListReturnsCards() throws Exception {
        build();
        LiveVersion lv = new LiveVersion("1.0.0", "/game/g/neon-raid/1.0.0/index.html", 42, "sha");
        when(catalog.listLive()).thenReturn(List.of(
                new GameCard("neon-raid", "霓虹突袭", null, "phaser-4", "typescript",
                        "/game/g/neon-raid/cover.png", new String[]{"arcade"}, lv)));

        mvc.perform(get("/api/games"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].slug").value("neon-raid"))
                .andExpect(jsonPath("$[0].liveVersion.version").value("1.0.0"));
    }

    @Test
    void gameDetail404UsesErrorEnvelope() throws Exception {
        build();
        when(catalog.detail("ghost")).thenThrow(
                com.sysou.gamevault.common.api.ApiException.notFound("GAME_NOT_FOUND", "游戏不存在或未上架：ghost"));

        mvc.perform(get("/api/games/ghost"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("GAME_NOT_FOUND"))
                .andExpect(jsonPath("$.error.message").exists());
    }

    @Test
    void playStartAndEnd() throws Exception {
        build();
        when(sessions.start("neon-raid")).thenReturn("abc123");

        mvc.perform(post("/api/play/start")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"gameSlug\":\"neon-raid\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.playSessionId").value("abc123"));

        mvc.perform(post("/api/play/end")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"playSessionId\":\"abc123\",\"durMs\":12345}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ok").value(true));
        verify(sessions).end("abc123", 12345L);
    }
}
