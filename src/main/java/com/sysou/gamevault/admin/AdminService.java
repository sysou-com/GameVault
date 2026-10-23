package com.sysou.gamevault.admin;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sysou.gamevault.achievement.AchievementApi;
import com.sysou.gamevault.catalog.CatalogApi;
import com.sysou.gamevault.catalog.entity.Game;
import com.sysou.gamevault.catalog.entity.GameVersion;
import com.sysou.gamevault.catalog.repo.GameRepository;
import com.sysou.gamevault.catalog.repo.GameVersionRepository;
import com.sysou.gamevault.common.api.ApiException;
import com.sysou.gamevault.common.job.JobKinds;
import com.sysou.gamevault.common.job.JobProducer;
import com.sysou.gamevault.common.props.GamevaultProps;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.regex.Pattern;
import java.util.zip.ZipInputStream;

/**
 * 管理台业务（01 文档 §5.3）：上传 → Job → 校验/落位 → 发布/回滚/上下架。
 *
 * <p>pkgmap（Redis，30 天）：packageId → {gameId, version, versionId}，
 * 供 Job 失败定位与 GET /api/admin/packages/{id} 查询（02 文档 §6.1 流程关联）。
 */
@Service
public class AdminService {

    private static final Logger log = LoggerFactory.getLogger(AdminService.class);
    private static final Pattern SLUG = Pattern.compile("^[a-z0-9][a-z0-9-]{1,63}$");

    private final GamevaultProps props;
    private final GameRepository games;
    private final GameVersionRepository versions;
    private final CatalogApi catalogApi;
    private final AchievementApi achievements;
    private final JobProducer producer;
    private final StringRedisTemplate redis;
    private final ObjectMapper mapper;

    public AdminService(GamevaultProps props, GameRepository games, GameVersionRepository versions,
                        CatalogApi catalogApi, AchievementApi achievements, JobProducer producer,
                        StringRedisTemplate redis, ObjectMapper mapper) {
        this.props = props;
        this.games = games;
        this.versions = versions;
        this.catalogApi = catalogApi;
        this.achievements = achievements;
        this.producer = producer;
        this.redis = redis;
        this.mapper = mapper;
    }

    public record UploadResult(String packageId, String jobId, String slug, String version, long versionId) {
    }

    /** 上传 zip（≤100MB，multipart）。返回后 Job 异步处理，状态走 GET /api/admin/packages/{packageId}。 */
    @Transactional
    public UploadResult upload(MultipartFile file) throws IOException {
        if (file == null || file.isEmpty()) {
            throw ApiException.badRequest("EMPTY_FILE", "上传文件为空");
        }
        byte[] bytes = file.getBytes();
        if (bytes.length > 100L * 1024 * 1024) {
            throw ApiException.badRequest("TOO_LARGE", "游戏包超过 100MB 上限");
        }
        JsonNode manifest = readManifest(bytes);
        String slug = manifest.path("game").asText("");
        String version = manifest.path("version").asText("");
        String entry = manifest.path("entry").asText("index.html");
        if (!SLUG.matcher(slug).matches()) {
            throw ApiException.badRequest("BAD_SLUG", "manifest.game 必须是 ^[a-z0-9][a-z0-9-]{1,63}$：" + slug);
        }
        if (!version.matches("^\\d+\\.\\d+\\.\\d+$")) {
            throw ApiException.badRequest("BAD_VERSION", "manifest.version 必须是 semver：" + version);
        }

        String packageId = JobProducer.newId();
        Path stagingDir = Path.of(props.stagingDir());
        Files.createDirectories(stagingDir);
        Path stagingFile = stagingDir.resolve(packageId + ".zip");
        Files.write(stagingFile, bytes);

        String sha = sha256Hex(bytes);
        String title = manifest.path("title").asText(slug);
        String engine = manifest.path("engine").asText("unknown");
        String language = manifest.path("language").asText("typescript");
        String cover = manifest.path("cover").asText("cover.png");

        catalogApi.registerUpload(slug, title, engine, language,
                "/game/g/" + slug + "/" + version + "/" + cover, manifest.toString(), version,
                "/game/g/" + slug + "/" + version + "/" + entry, sha, bytes.length);

        Game g = games.findBySlug(slug).orElseThrow();
        GameVersion v = versions.findByGameIdAndVersion(g.getId(), version).orElseThrow();
        redis.opsForValue().set("pkgmap:" + packageId, mapper.writeValueAsString(Map.of(
                "gameId", g.getId(), "slug", slug, "version", version, "versionId", v.getId())), Duration.ofDays(30));

        String jobId = producer.publish(JobKinds.GAME_PACKAGE_PROCESS, packageId,
                Map.of("packageId", packageId, "slug", slug, "version", version));
        return new UploadResult(packageId, jobId, slug, version, v.getId());
    }

    /** 管理台轮询：Job 状态 + 版本行状态 + 报告。 */
    public PackageStatus packageStatus(String packageId) {
        JsonNode map = pkgmap(packageId);
        JsonNode state = producer.state(packageId);
        PackageStatus ps = new PackageStatus(packageId,
                state != null ? state.path("status").asText("UNKNOWN") : "UNKNOWN",
                null, null, null, null);
        if (map != null) {
            String slug = map.path("slug").asText();
            String version = map.path("version").asText();
            java.util.Optional<GameVersion> vOpt = games.findBySlug(slug)
                    .flatMap(gl -> versions.findByGameIdAndVersion(gl.getId(), version));
            if (vOpt.isPresent()) {
                GameVersion v = vOpt.get();
                ps = new PackageStatus(packageId, ps.jobStatus(), v.getStatus(), v.getEntryUrl(), v.getStatusReport(), version);
            }
        }
        return ps;
    }

    public record PackageStatus(String packageId, String jobStatus, String versionStatus,
                                String entryUrl, String report, String version) {
    }

    /**
     * 发布（ready/live/rolled_back → live；同游戏原 live → rolled_back）。
     * <p>M2 两道闸门：① needsReview 未确认 → 409（校验报告 review 项须人工确认，02 文档 §6）；
     * ② 发布后探针失败 → 自动回滚上一 live（02 文档 §6.4）。
     */
    public GameVersion publish(Long versionId) {
        GameVersion target = versions.findById(versionId)
                .orElseThrow(() -> ApiException.notFound("VERSION_NOT_FOUND", "版本不存在：" + versionId));
        if (hasUnconfirmedReview(target)) {
            throw ApiException.conflict("NEEDS_REVIEW_CONFIRM",
                    "校验报告存在待人工审查项，请先在管理台确认后再发布");
        }
        Optional<GameVersion> prevLive = versions.findFirstByGameIdAndStatus(target.getGameId(), "live")
                .filter(lv -> !lv.getId().equals(target.getId()));
        GameVersion v = catalogApi.publish(versionId);
        ProbeResult pr = probe(v);
        if (pr.failed() && prevLive.isPresent()) {
            GameVersion prev = prevLive.get();
            log.error("发布后探针失败，自动回滚 {} → {}（02 文档 §6.4）: {}", v.getVersion(), prev.getVersion(), pr.detail());
            catalogApi.publish(prev.getId());
            syncAchievements(prev); // 回滚后成就定义随回滚版本回写
            throw ApiException.conflict("PROBE_FAILED_ROLLBACK",
                    "发布后探针失败，已自动回滚到 " + prev.getVersion() + "：" + pr.detail());
        }
        syncAchievements(v);
        return v;
    }

    /** 发布时以包内为准回写成就定义（02 文档 §3.1；manifest.achievements 缺省 = 不动现有定义）。 */
    private void syncAchievements(GameVersion v) {
        try {
            String slug = games.findById(v.getGameId()).map(Game::getSlug).orElse("");
            achievements.syncFromManifest(slug, mapper.readTree(v.getManifest()));
        } catch (Exception e) {
            log.warn("成就定义回写失败 versionId={}: {}", v.getId(), e.toString());
        }
    }

    /** M2：needsReview 人工确认（写 status_report.reviewConfirmedAt；重新上传新包会重置闸门）。 */
    @Transactional
    public void confirmReview(Long versionId) {
        GameVersion v = versions.findById(versionId)
                .orElseThrow(() -> ApiException.notFound("VERSION_NOT_FOUND", "版本不存在：" + versionId));
        if (!"ready".equals(v.getStatus())) {
            throw ApiException.conflict("NOT_READY", "仅 ready 版本可确认审查项，当前：" + v.getStatus());
        }
        if (!hasUnconfirmedReview(v)) {
            throw ApiException.conflict("NOTHING_TO_CONFIRM", "该版本无待确认的审查项");
        }
        com.fasterxml.jackson.databind.node.ObjectNode o = reportNode(v);
        o.put("reviewConfirmedAt", java.time.Instant.now().toString());
        v.setStatusReport(o.toString());
        versions.save(v);
        log.info("needsReview 已确认 versionId={} slug v={}", versionId, v.getVersion());
    }

    /** 闸门判定：报告含 review 项且未确认（report 以字符串前缀 "review: " 标记审查项，见 PackageValidator）。 */
    private boolean hasUnconfirmedReview(GameVersion v) {
        com.fasterxml.jackson.databind.JsonNode rep = parseReport(v);
        if (rep == null) return false;
        if (rep.has("reviewConfirmedAt")) return false;
        var arr = rep.path("report");
        if (!arr.isArray()) return rep.path("needsReview").asBoolean(false);
        for (var e : arr) {
            if (e.isTextual() && e.asText().startsWith("review:")) return true;
        }
        return rep.path("needsReview").asBoolean(false);
    }

    private com.fasterxml.jackson.databind.JsonNode parseReport(GameVersion v) {
        try {
            String raw = v.getStatusReport();
            if (raw == null || raw.isBlank()) return null;
            return mapper.readTree(raw);
        } catch (Exception e) {
            return null;
        }
    }

    private com.fasterxml.jackson.databind.node.ObjectNode reportNode(GameVersion v) {
        var rep = parseReport(v);
        if (rep != null && rep.isObject()) return (com.fasterxml.jackson.databind.node.ObjectNode) rep;
        return mapper.createObjectNode();
    }

    /** 探针结果（02 文档 §6.4）：DISABLED（dev 默认关）/ OK / FAILED(detail)。 */
    private record ProbeResult(boolean failed, String detail) {
        static ProbeResult disabled() { return new ProbeResult(false, "探针未启用"); }
        static ProbeResult ok() { return new ProbeResult(false, ""); }
        static ProbeResult failed(String detail) { return new ProbeResult(true, detail); }
    }

    /** 发布后探针（02 文档 §6.4）：回环请求 nginx，断言 200 + COOP/COEP 头；失败 → 自动回滚（M2 起）。 */
    private ProbeResult probe(GameVersion v) {
        if (!props.nginxProbe().enabled()) return ProbeResult.disabled();
        try {
            var resp = org.springframework.web.client.RestClient.create()
                    .get().uri(props.nginxProbe().baseUrl() + v.getEntryUrl())
                    .header("Accept", "text/html").retrieve()
                    .toBodilessEntity();
            boolean headers = "same-origin".equalsIgnoreCase(
                    resp.getHeaders().getFirst("Cross-Origin-Opener-Policy"))
                    && resp.getHeaders().getFirst("Cross-Origin-Embedder-Policy") != null;
            if (!resp.getStatusCode().is2xxSuccessful() || !headers) {
                return ProbeResult.failed("status=" + resp.getStatusCode() + " coop/coep=" + headers);
            }
            return ProbeResult.ok();
        } catch (Exception e) {
            return ProbeResult.failed(e.toString());
        }
    }

    @Transactional
    public void disable(String slug) {
        Game g = games.findBySlug(slug).orElseThrow(() -> ApiException.notFound("GAME_NOT_FOUND", slug));
        g.setStatus("disabled");
    }

    @Transactional
    public void enable(String slug) {
        Game g = games.findBySlug(slug).orElseThrow(() -> ApiException.notFound("GAME_NOT_FOUND", slug));
        boolean hasLive = versions.findFirstByGameIdAndStatus(g.getId(), "live").isPresent();
        g.setStatus(hasLive ? "live" : "draft");
    }

    @Transactional(readOnly = true)
    public List<GameAdminRow> listAll() {
        return nullSafeAll().stream().map(this::row).toList();
    }

    private List<Game> nullSafeAll() {
        var all = new java.util.ArrayList<Game>();
        for (String s : new String[]{"draft", "live", "disabled"}) all.addAll(games.findAllByStatus(s));
        return all;
    }

    private GameAdminRow row(Game g) {
        GameVersion lv = versions.findFirstByGameIdAndStatus(g.getId(), "live").orElse(null);
        List<String> vs = versions.findByGameIdOrderByIdDesc(g.getId()).stream()
                .map(x -> x.getVersion() + ":" + x.getStatus()).toList();
        return new GameAdminRow(g.getId(), g.getSlug(), g.getTitle(), g.getStatus(),
                lv != null ? lv.getVersion() : null, vs);
    }

    public record GameAdminRow(Long id, String slug, String title, String status, String liveVersion, List<String> versions) {
    }

    private JsonNode readManifest(byte[] zipBytes) {
        try (var zin = new ZipInputStream(new java.io.ByteArrayInputStream(zipBytes))) {
            var e = zin.getNextEntry();
            while (e != null) {
                if ("manifest.json".equals(e.getName())) {
                    String raw = new String(zin.readAllBytes(), StandardCharsets.UTF_8);
                    return mapper.readTree(raw);
                }
                e = zin.getNextEntry();
            }
        } catch (IOException e) {
            throw ApiException.badRequest("BAD_ZIP", "不是有效的 zip：" + e.getMessage());
        }
        throw ApiException.badRequest("NO_MANIFEST", "包内缺少 manifest.json");
    }

    private JsonNode pkgmap(String packageId) {
        String raw = redis.opsForValue().get("pkgmap:" + packageId);
        if (raw == null) return null;
        try {
            return mapper.readTree(raw);
        } catch (Exception e) {
            return null;
        }
    }

    private static String sha256Hex(byte[] bytes) throws IOException {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IOException(e);
        }
    }
}
