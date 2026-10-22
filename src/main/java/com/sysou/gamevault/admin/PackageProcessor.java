package com.sysou.gamevault.admin;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sysou.gamevault.catalog.repo.GameRepository;
import com.sysou.gamevault.catalog.repo.GameVersionRepository;
import com.sysou.gamevault.common.job.JobHandler;
import com.sysou.gamevault.common.job.JobKinds;
import com.sysou.gamevault.common.props.GamevaultProps;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.List;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * 游戏包处理 Job（02 文档 §6.1：校验 → 解压落位 → 版本状态）。
 * 幂等键 = packageId（重放安全：目标目录先清后解，状态收敛为 ready/failed）。
 */
@Component
public class PackageProcessor implements JobHandler {

    private static final Logger log = LoggerFactory.getLogger(PackageProcessor.class);

    private final GamevaultProps props;
    private final GameRepository games;
    private final GameVersionRepository versions;
    private final PackageValidator validator;
    private final ObjectMapper mapper;
    private final org.springframework.data.redis.core.StringRedisTemplate redis;

    public PackageProcessor(GamevaultProps props, GameRepository games,
                            GameVersionRepository versions, PackageValidator validator,
                            ObjectMapper mapper, org.springframework.data.redis.core.StringRedisTemplate redis) {
        this.props = props;
        this.games = games;
        this.versions = versions;
        this.validator = validator;
        this.mapper = mapper;
        this.redis = redis;
    }

    @Override
    public String kind() {
        return JobKinds.GAME_PACKAGE_PROCESS;
    }

    @Override
    public void handle(Map<String, String> payload, String idempotencyKey) {
        try {
            doHandle(payload, idempotencyKey);
        } catch (IOException e) {
            throw new IllegalStateException("包处理 IO 失败: " + e.getMessage(), e);
        }
    }

    private void doHandle(Map<String, String> payload, String idempotencyKey) throws IOException {
        String packageId = payload.get("packageId");
        String slug = payload.get("slug");
        String version = payload.get("version");
        if (packageId == null || slug == null || version == null) {
            throw new IllegalStateException("payload 缺字段: " + payload);
        }
        Path stagingFile = Path.of(props.stagingDir(), packageId + ".zip");
        if (!Files.exists(stagingFile)) {
            markFailed(idempotencyKey, "staging 文件缺失: " + stagingFile);
            return;
        }
        byte[] zipBytes = Files.readAllBytes(stagingFile);

        // ② 校验（02 文档 §6.2–6.3）——先校验后动磁盘，失败绝不影响现有版本
        PackageValidator.Result result;
        try (InputStream in = new java.io.BufferedInputStream(new java.io.ByteArrayInputStream(zipBytes))) {
            result = validator.validate(in, zipBytes.length);
        }
        if (!result.ok()) {
            markFailed(idempotencyKey, "校验失败: " + String.join("; ", result.report()));
            return;
        }


        // ③ 解压到 .tmp，校验通过后才替换旧目录（02 文档 §6.1 ③：tmp + 原子改名，不直接写目标路径）
        Path target = Path.of(props.gamesDir(), slug, version);
        Path tmp = Path.of(props.gamesDir(), slug, version + ".tmp");
        deleteRecursively(tmp);
        Files.createDirectories(tmp);
        extract(stagingFile, tmp);
        deleteRecursively(target);
        Files.move(tmp, target);

        // ④ 版本状态 ready + 报告（needsReview 项由管理台展示，M2 加发布闸门）
        String reportJson = toJson(Map.of(
                "ok", true,
                "needsReview", result.needsReview(),
                "report", result.report()));
        games.findBySlug(slug).flatMap(g -> versions.findByGameIdAndVersion(g.getId(), version))
                .ifPresent(v -> {
                    v.setStatus("ready");
                    v.setStatusReport(reportJson);
                    versions.save(v);
                });
        log.info("包处理完成 packageId={} slug={} v={} review={}", packageId, slug, version, result.needsReview());
    }

    private void extract(Path zipFile, Path outDir) throws IOException {
        try (var zin = new ZipInputStream(Files.newInputStream(zipFile))) {
            ZipEntry e;
            while ((e = zin.getNextEntry()) != null) {
                Path target = outDir.resolve(e.getName()).normalize();
                // zip-slip 二次防护（校验器已查过，解压再查一层）
                if (!target.startsWith(outDir)) {
                    throw new IOException("zip-slip: " + e.getName());
                }
                if (e.isDirectory()) {
                    Files.createDirectories(target);
                } else {
                    Files.createDirectories(target.getParent());
                    Files.copy(zin, target, StandardCopyOption.REPLACE_EXISTING);
                }
                zin.closeEntry();
            }
        }
    }

    private void markFailed(String idempotencyKey, String reason) {
        log.warn("包处理失败 idem={}: {}", idempotencyKey, reason);
        // 通过 pkgmap 定位版本行（AdminService 上传时写入）
        com.fasterxml.jackson.databind.JsonNode map = pkgmap(idempotencyKey);
        if (map == null) return;
        long gameId = map.path("gameId").asLong();
        String version = map.path("version").asText();
        versions.findByGameIdAndVersion(gameId, version).ifPresent(v -> {
            v.setStatus("failed");
            v.setStatusReport(toJson(Map.of("ok", false, "report", List.of(reason))));
            versions.save(v);
        });
    }

    private String toJson(Object o) {
        try {
            return mapper.writeValueAsString(o);
        } catch (Exception e) {
            throw new IllegalStateException("JSON 序列化失败: " + e.getMessage(), e);
        }
    }

    private com.fasterxml.jackson.databind.JsonNode pkgmap(String packageId) {
        String raw = redis.opsForValue().get("pkgmap:" + packageId);
        if (raw == null) return null;
        try {
            return mapper.readTree(raw);
        } catch (Exception e) {
            return null;
        }
    }

    private void deleteRecursively(Path root) throws IOException {
        if (!Files.exists(root)) return;
        try (var walk = Files.walk(root)) {
            walk.sorted(java.util.Comparator.reverseOrder()).forEach(p -> {
                try {
                    Files.deleteIfExists(p);
                } catch (IOException ignored) {
                }
            });
        }
    }
}
