package com.sysou.gamevault.api;

import com.sysou.gamevault.player.PlaySessionService;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * 试玩会话（01 文档 §2 player 模块最小集）：M1 只埋点，游客可用。
 * 前端/GameFrame.vue 与游戏 bridge（02 文档 §4）在 iframe 装载/卸载时调用。
 */
@RestController
@RequestMapping("/api/play")
public class PlayController {

    private final PlaySessionService sessions;

    public PlayController(PlaySessionService sessions) {
        this.sessions = sessions;
    }

    public record StartRequest(String gameSlug) {
    }

    public record EndRequest(String playSessionId, long durMs) {
    }

    @PostMapping("/start")
    public Map<String, String> start(@RequestBody StartRequest req) {
        String id = sessions.start(req.gameSlug());
        return Map.of("playSessionId", id);
    }

    @PostMapping("/end")
    public Map<String, Object> end(@RequestBody EndRequest req) {
        sessions.end(req.playSessionId(), req.durMs());
        return Map.of("ok", true);
    }
}
