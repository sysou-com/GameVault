package com.sysou.gamevault;

import com.sun.net.httpserver.HttpServer;
import io.jsonwebtoken.Jwts;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import com.sysou.gamevault.common.job.JobKinds;
import com.sysou.gamevault.common.job.JobProducer;

import java.math.BigInteger;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.interfaces.ECPrivateKey;
import java.security.interfaces.ECPublicKey;
import java.security.spec.ECGenParameterSpec;
import java.util.Base64;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
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

    // ---- M2：本地 JWKS + 本地签名中心 JWT（不依赖远端中心；验证 JwtVerifier 真实验签路径）----
    static final String TEST_ISSUER = "https://www.sysou.com/manage";
    static final String TEST_KID = "gamevault-it";
    static KeyPair testKeyPair;
    static HttpServer jwksServer;
    static int jwksPort;

    @AfterAll
    static void stopJwks() {
        if (jwksServer != null) jwksServer.stop(0);
    }

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
        try {
            startLocalJwks();
        } catch (Exception e) {
            throw new IllegalStateException("本地 JWKS 启动失败", e);
        }
        r.add("gamevault.jwt.jwks-url", () -> "http://127.0.0.1:" + jwksPort + "/jwks");
        r.add("gamevault.jwt.issuer", () -> TEST_ISSUER);
    }

    /** 本地 JWKS 服务（随机端口）+ EC P-256 密钥对：中心同构（ES256，JWKS x/y 为 32 字节 base64url）。 */
    static void startLocalJwks() throws Exception {
        KeyPairGenerator gen = KeyPairGenerator.getInstance("EC");
        gen.initialize(new ECGenParameterSpec("secp256r1"));
        testKeyPair = gen.generateKeyPair();
        ECPublicKey pub = (ECPublicKey) testKeyPair.getPublic();
        String x = b64url(pad(pub.getW().getAffineX(), 32));
        String y = b64url(pad(pub.getW().getAffineY(), 32));
        String jwks = "{\"keys\":[{\"kty\":\"EC\",\"crv\":\"P-256\",\"use\":\"sig\",\"alg\":\"ES256\","
                + "\"kid\":\"" + TEST_KID + "\",\"x\":\"" + x + "\",\"y\":\"" + y + "\"}]}";
        jwksServer = HttpServer.create(new InetSocketAddress(0), 0);
        jwksPort = jwksServer.getAddress().getPort();
        jwksServer.createContext("/jwks", ex -> {
            byte[] body = jwks.getBytes(StandardCharsets.UTF_8);
            ex.getResponseHeaders().add("Content-Type", "application/json");
            ex.sendResponseHeaders(200, body.length);
            ex.getResponseBody().write(body);
            ex.close();
        });
        jwksServer.start();
    }

    static String signTestJwt(String sub, String email) {
        return Jwts.builder()
                .header().keyId(TEST_KID).and()
                .issuer(TEST_ISSUER)
                .subject(sub)
                .claim("email", email)
                .claim("roles", List.of("gamevault_user"))
                .claim("pv", 1L)
                .claim("pa", false)
                .expiration(new Date(System.currentTimeMillis() + 30 * 60_000))
                .signWith((ECPrivateKey) testKeyPair.getPrivate(), Jwts.SIG.ES256)
                .compact();
    }

    static String b64url(byte[] b) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(b);
    }

    static byte[] pad(BigInteger v, int len) {
        byte[] raw = v.toByteArray();
        byte[] out = new byte[len];
        if (raw.length > len) {
            System.arraycopy(raw, raw.length - len, out, 0, len);
        } else {
            System.arraycopy(raw, 0, out, len - raw.length, raw.length);
        }
        return out;
    }

    @Autowired
    MockMvc mvc;

    @Autowired
    JobProducer jobProducer;

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

    /**
     * M2 分数全链路（本地 JWKS 签名中心 JWT）：
     * 上传带成就的游戏 → 发布/上架 → 签名 JWT 提分（ok+rank+解锁）→ 幂等重放 →
     * 榜单可见（myRank）→ SCORE_SETTLE Job 落 user_score → 我的分数/成就 → 越界拒绝 400。
     */
    @Test
    void m2ScoreChainWithSignedJwt() throws Exception {
        // ① 自包含游戏：it-score 1.0.0（score 0–999999 + 成就 FIRST_100 = score_gte 100）
        String uploadBody = mvc.perform(multipart("/api/admin/packages").file(new MockMultipartFile(
                        "file", "it-score.zip", "application/zip", buildZip("it-score", "1.0.0", m2Manifest()))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.slug").value("it-score"))
                .andReturn().getResponse().getContentAsString();
        String packageId = extractJsonField(uploadBody, "packageId");
        long versionId = Long.parseLong(extractJsonField(uploadBody, "versionId"));
        String versionStatus = null;
        for (int i = 0; i < 60; i++) {
            String st = mvc.perform(get("/api/admin/packages/" + packageId)).andReturn().getResponse().getContentAsString();
            versionStatus = extractJsonField(st, "versionStatus");
            if ("ready".equals(versionStatus) || "failed".equals(versionStatus)) break;
            Thread.sleep(500);
        }
        assertEquals("ready", versionStatus, "it-score Job 处理失败");
        mvc.perform(post("/api/admin/versions/" + versionId + "/publish")).andExpect(status().isOk());
        mvc.perform(post("/api/admin/games/it-score/enable")).andExpect(status().isOk());

        // ② 签名中心 JWT（本地 JWKS 验签路径）
        String sub = UUID.randomUUID().toString();
        String jwt = signTestJwt(sub, "it-player@example.com");
        String auth = "Bearer " + jwt;

        // ③ 提分：ok + rank=1 + 成就解锁 FIRST_100
        mvc.perform(post("/api/scores").header("Authorization", auth)
                        .contentType(org.springframework.http.MediaType.APPLICATION_JSON)
                        .content("{\"gameSlug\":\"it-score\",\"score\":150,\"meta\":{\"bestCombo\":7},"
                                + "\"clientTs\":" + System.currentTimeMillis() + ",\"idempotencyKey\":\"it-k-1\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ok"))
                .andExpect(jsonPath("$.rank").value(1))
                .andExpect(jsonPath("$.unlocked[0]").value("FIRST_100"));

        // ④ 幂等重放（同 key → 200 同结果，不重发成就）
        mvc.perform(post("/api/scores").header("Authorization", auth)
                        .contentType(org.springframework.http.MediaType.APPLICATION_JSON)
                        .content("{\"gameSlug\":\"it-score\",\"score\":150,\"clientTs\":" + System.currentTimeMillis()
                                + ",\"idempotencyKey\":\"it-k-1\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.rank").value(1))
                .andExpect(jsonPath("$.unlocked").isArray());

        // ⑤ 榜单可见（含 myRank；展示名 = JWT email）
        mvc.perform(get("/api/games/it-score/leaderboard?scope=all").header("Authorization", auth))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.entries[0].userName").value("it-player@example.com"))
                .andExpect(jsonPath("$.entries[0].score").value(150))
                .andExpect(jsonPath("$.myRank").value(1));

        // ⑥ settle 前 user_score 未落库 → 触发 SCORE_SETTLE Job → 轮询落库
        mvc.perform(get("/api/me/scores?gameSlug=it-score").header("Authorization", auth))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0]").doesNotExist());
        jobProducer.publish(JobKinds.SCORE_SETTLE, "it-settle-1", Map.of());
        boolean settled = false;
        for (int i = 0; i < 30; i++) {
            String s = mvc.perform(get("/api/me/scores?gameSlug=it-score").header("Authorization", auth))
                    .andReturn().getResponse().getContentAsString();
            if (s.contains("\"score\":150")) { settled = true; break; }
            Thread.sleep(500);
        }
        assertTrue(settled, "SCORE_SETTLE 未在 15s 内落 user_score");

        // ⑦ 我的成就（发放时已写 achievement_grant）
        mvc.perform(get("/api/me/achievements?gameSlug=it-score").header("Authorization", auth))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].code").value("FIRST_100"));

        // ⑧ 越界拒绝（> max 999999 → 400 + 审计行 rejected_bounds）
        mvc.perform(post("/api/scores").header("Authorization", auth)
                        .contentType(org.springframework.http.MediaType.APPLICATION_JSON)
                        .content("{\"gameSlug\":\"it-score\",\"score\":1000000,\"clientTs\":" + System.currentTimeMillis()
                                + ",\"idempotencyKey\":\"it-k-2\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("SCORE_OUT_OF_RANGE"));
    }

    /** M2 测试用 manifest（分数区间 + metaSchema + 成就定义；02 文档 §3.1）。 */
    private static String m2Manifest() {
        return "{\"schema\":\"gamevault/manifest@1\",\"game\":\"it-score\",\"version\":\"1.0.0\",\"title\":\"M2 分数链路\","
                + "\"engine\":\"canvas-native\",\"language\":\"typescript\",\"entry\":\"index.html\",\"cover\":\"cover.png\","
                + "\"size\":{\"totalBytes\":999,\"initialLoadBytes\":100},"
                + "\"score\":{\"enabled\":true,\"range\":[0,999999],\"minPlayMs\":1000,"
                + "\"metaSchema\":{\"bestCombo\":{\"type\":\"int\",\"range\":[0,9999]}}},"
                + "\"achievements\":[{\"code\":\"FIRST_100\",\"title\":\"破百\",\"description\":\"单局 100 分\","
                + "\"rule\":{\"type\":\"score_gte\",\"value\":100}}]}";
    }

    private static byte[] buildZip(String slug, String version) throws Exception {
        String manifest = String.format(
                "{\"schema\":\"gamevault/manifest@1\",\"game\":\"%s\",\"version\":\"%s\",\"title\":\"集成测试\","
                        + "\"engine\":\"canvas-native\",\"language\":\"typescript\",\"entry\":\"index.html\",\"cover\":\"cover.png\","
                        + "\"size\":{\"totalBytes\":999,\"initialLoadBytes\":100},\"score\":{\"enabled\":true,\"range\":[0,9999]}}",
                slug, version);
        return buildZipFor(manifest);
    }

    /** 带自定义 manifest 的造包（M2 分数链路测试用）。 */
    private static byte[] buildZip(String slug, String version, String manifest) throws Exception {
        return buildZipFor(manifest);
    }

    private static byte[] buildZipFor(String manifest) throws Exception {
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
