package com.sysou.gamevault;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

/**
 * GameVault —— 游戏展示与试玩平台（docs/design/01）。
 *
 * <p>模块化单体（与兄弟工程同款纪律）：模块 = 包（api / catalog / player / admin / common），
 * 跨模块只走各模块暴露的 *Api 接口。M2 起新增 leaderboard / achievement / telemetry 模块。
 */
@SpringBootApplication
@ConfigurationPropertiesScan
public class GameVaultApplication {

    public static void main(String[] args) {
        SpringApplication.run(GameVaultApplication.class, args);
    }
}
