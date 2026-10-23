package com.sysou.gamevault.admin;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
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
    private final JobProducer producer;
    private final StringRedisTemplate redis;
    private final ObjectMapper mapper;

    public AdminService(GamevaultProps props, GameRepository games, GameVersionRepository versions,
                        CatalogApi catalogApi, JobProducer producer,
                        StringRedisTemplate redis, ObjectMapper mapper) {
        this.props = props;
        this.games = games;
        this.versions = versions;
        this.catalogApi = catalogApi;
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

    /** 发布（ready/live/rolled_back → live；同游戏原 live → rolled_back）+ 可选探针。 */
    public GameVersion publish(Long versionId) {
        GameVersion v = catalogApi.publish(versionId);
        probe(v);
        return v;
    }

    /**
     * 发布后探针（02 文档 §6.4）：回环请求 nginx，断言 200 + COOP/COEP 头。
     * M1：失败仅告警日志（自动回滚 M2 随管理台一起落，见 02 文档 §8 验收清单）。
     */
    private void probe(GameVersion v) {
        if (!props.nginxProbe().enabled()) return;
        try {
            var resp = org.springframework.web.client.RestClient.create()
                    .get().uri(props.nginxProbe().baseUrl() + v.getEntryUrl())
                    .header("Accept", "text/html").retrieve()
                    .toBodilessEntity();
            boolean headers = "same-origin".equalsIgnoreCase(
                    resp.getHeaders().getFirst("Cross-Origin-Opener-Policy"))
                    && resp.getHeaders().getFirst("Cross-Origin-Embedder-Policy") != null;
            if (!resp.getStatusCode().is2xxSuccessful() || !headers) {
                log.warn("探针异常 version={}: status={} coop/coep={}", v.getId(), resp.getStatusCode(), headers);
            }
        } catch (Exception e) {
            log.warn("探针失败 version={}（M2 起自动回滚）: {}", v.getId(), e.toString());
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
