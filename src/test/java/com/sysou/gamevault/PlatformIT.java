package com.sysou.gamevault;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 平台全链路集成测试（01 文档 §10 端到端脚本的自动化版）。
 *
 * <p>需要 dev 隧道（VPS PG gamevault 库 @54329 + Redis @6380），默认不跑：
 * {@code mvn test -Dgamevault.it.enabled=true}（凭据读 .env.dev，0600，gitignored）。
 *
 * <p>流程：Flyway 迁移 → JPA validate → 健康探针 → 管理台上传 zip → Job 校验/落位 →
 * 发布 → 上架 → 公开详情可见 → 磁盘文件存在。
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureMockMvc
@EnabledIfSystemProperty(named = "gamevault.it.enabled", matches = "true")
class PlatformIT {

    /** 开发库凭据只存在 .env.dev（0600，gitignored），不入库不打印（兄弟工程同款纪律）。 */
    @DynamicPropertySource
    static void devProps(DynamicPropertyRegistry r) {
        Map<String, String> env = new LinkedHashMap<>();
        try {
            Path f = Path.of(".env.dev");
            if (Files.exists(f)) {
                for (String line : Files.readAllLines(f)) {
                    if (line.isBlank() || line.startsWith("#")) continue;
                    int i = line.indexOf('=');
                    if (i > 0) env.put(line.substring(0, i).trim(), line.substring(i + 1).trim());
                }
            }
        } catch (Exception ignored) {
        }
        r.add("spring.datasource.url", () -> env.getOrDefault("GAMEVAULT_DEV_DB_URL", "jdbc:postgresql://127.0.0.1:54329/gamevault"));
        r.add("spring.datasource.username", () -> env.getOrDefault("GAMEVAULT_DEV_DB_USER", "gamevault_dev"));
        r.add("spring.datasource.password", () -> env.getOrDefault("GAMEVAULT_DEV_DB_PASSWORD", ""));
        r.add("spring.data.redis.host", () -> "127.0.0.1");
        r.add("spring.data.redis.port", () -> env.getOrDefault("GAMEVAULT_DEV_REDIS_PORT", "6380"));
        r.add("spring.data.redis.password", () -> env.getOrDefault("GAMEVAULT_DEV_REDIS_PASSWORD", ""));
        r.add("spring.data.redis.database", () -> "6");   // dev 用 db6，避开兄弟工程
        r.add("gamevault.games-dir", () -> "target/it/games");
        r.add("gamevault.staging-dir", () -> "target/it/staging");
        r.add("gamevault.nginx-probe.enabled", () -> "false");
        r.add("gamevault.admin.enforce-auth", () -> "false");
    }

    @Autowired
    MockMvc mvc;

    @Test
    void fullUploadPublishPlayPipeline() throws Exception {
        // 健康探针（Flyway 已迁移 + JPA validate 已过，能起上下文即结构正确）
        mvc.perform(get("/api/health")).andExpect(status().isOk())
                .andExpect(jsonPath("$.ok").value(true));

        // 造一个最小合法游戏包
        byte[] zip = buildZip("it-rush", "1.0.0");
        MockMultipartFile file = new MockMultipartFile("file", "it-rush.zip",
                "application/zip", zip);

        String uploadResp = mvc.perform(multipart("/api/admin/packages").file(file))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.slug").value("it-rush"))
                .andExpect(jsonPath("$.version").value("1.0.0"))
                .andReturn().getResponse().getContentAsString();
        String packageId = extractJsonField(uploadResp, "packageId");
        long versionId = Long.parseLong(extractJsonField(uploadResp, "versionId"));

        // 轮询 Job → ready（消费组轮询 ~0.25s/次，30s 足够）
        String versionStatus = null;
        for (int i = 0; i < 60; i++) {
            String st = mvc.perform(get("/api/admin/packages/" + packageId))
                    .andExpect(status().isOk())
                    .andReturn().getResponse().getContentAsString();
            versionStatus = extractJsonField(st, "versionStatus");
            if ("ready".equals(versionStatus) || "failed".equals(versionStatus)) break;
            Thread.sleep(500);
        }
        assertEquals("ready", versionStatus, "Job 处理未完成或失败");

        // 发布（同游戏原 live → rolled_back）
        mvc.perform(post("/api/admin/versions/" + versionId + "/publish"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.entryUrl").value("/game/g/it-rush/1.0.0/index.html"));

        // 上架
        mvc.perform(post("/api/admin/games/it-rush/enable")).andExpect(status().isOk());

        // 公开详情可见（builds 恒 web 一条 = N0 预留）
        mvc.perform(get("/api/games/it-rush"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.slug").value("it-rush"))
                .andExpect(jsonPath("$.liveVersion.version").value("1.0.0"))
                .andExpect(jsonPath("$.builds[0].platform").value("web"));

        // 目录可见
        mvc.perform(get("/api/games"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.slug=='it-rush')]").exists());

        // 磁盘落位（02 文档 §2 目录布局）
        assertTrue(Files.exists(Path.of("target/it/games/it-rush/1.0.0/index.html")), "解压落位失败");
        assertTrue(Files.exists(Path.of("target/it/games/it-rush/1.0.0/manifest.json")));

        // ---- M2：提分只收登录态（游客/垃圾令牌 → 401；01 文档 §5.2/§7 红线）----
        mvc.perform(post("/api/scores")
                        .contentType(org.springframework.http.MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("UNAUTHORIZED"));
        mvc.perform(post("/api/scores")
                        .header("Authorization", "Bearer garbage.token.here")
                        .contentType(org.springframework.http.MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isUnauthorized());
        mvc.perform(get("/api/me")).andExpect(status().isUnauthorized());

        // ---- M2：榜单公开读（it-rush 刚发布，空榜 → 空 entries；登录态才有 myRank）----
        mvc.perform(get("/api/games/it-rush/leaderboard"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.entries").isArray());

        // ---- M2：目录卡片带 topScores（空榜 → 空数组）----
        mvc.perform(get("/api/games"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.slug=='it-rush')].topScores").isArray());
    }

    private static byte[] buildZip(String slug, String version) throws Exception {
        String manifest = String.format(
                "{\"schema\":\"gamevault/manifest@1\",\"game\":\"%s\",\"version\":\"%s\",\"title\":\"集成测试\","
                        + "\"engine\":\"canvas-native\",\"language\":\"typescript\",\"entry\":\"index.html\",\"cover\":\"cover.png\","
                        + "\"size\":{\"totalBytes\":999,\"initialLoadBytes\":100},\"score\":{\"enabled\":true,\"range\":[0,9999]}}",
                slug, version);
        java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
        try (var zos = new ZipOutputStream(bos)) {
            zos.putNextEntry(new ZipEntry("manifest.json"));
            zos.write(manifest.getBytes(StandardCharsets.UTF_8));
            zos.closeEntry();
            zos.putNextEntry(new ZipEntry("index.html"));
            zos.write("<html><body>IT</body></html>".getBytes(StandardCharsets.UTF_8));
            zos.closeEntry();
            zos.putNextEntry(new ZipEntry("cover.png"));
            zos.write(new byte[]{1, 2, 3});
            zos.closeEntry();
        }
        return bos.toByteArray();
    }

    /** 极简 JSON 字段抽取（避免额外依赖；值恒为字符串/数字无嵌套）。 */
    private static String extractJsonField(String json, String field) {
        int i = json.indexOf("\"" + field + "\"");
        if (i < 0) return null;
        int c = json.indexOf(':', i);
        int start = c + 1;
        while (start < json.length() && Character.isWhitespace(json.charAt(start))) start++;
        if (start < json.length() && json.charAt(start) == '"') {
            int end = json.indexOf('"', start + 1);
            return json.substring(start + 1, end);
        }
        int end = start;
        while (end < json.length() && (Character.isDigit(json.charAt(end)) || json.charAt(end) == '-')) end++;
        return json.substring(start, end);
    }
}
