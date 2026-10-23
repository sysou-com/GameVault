package com.sysou.gamevault.admin;

import com.sysou.gamevault.api.AuthFilter;
import com.sysou.gamevault.api.JwtVerifier.VerifiedToken;
import com.sysou.gamevault.api.PermCache;
import com.sysou.gamevault.catalog.entity.GameVersion;
import com.sysou.gamevault.common.api.ApiException;
import com.sysou.gamevault.common.props.GamevaultProps;
import com.sysou.gamevault.leaderboard.LeaderboardApi;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.Map;

/**
 * 管理台 API（01 文档 §5.3）。
 *
 * <p><b>鉴权（M2）</b>：AuthFilter 对 Bearer 令牌验签（enforce-auth 开启时未验证一律 401）；
 * 权限点硬校（中心 §4.6 裁定 #21）：{@code admin.enforce-auth=true} 时按端点校验中心权限点
 * （回源 /manage/internal/perms，pv 缓存）：
 * <ul>
 *   <li>{@code gamevault:admin:package} — 包管理（上传 / 状态）</li>
 *   <li>{@code gamevault:admin:publish} — 发布（publish / rollback / confirm-review）</li>
 *   <li>{@code gamevault:admin:game-status} — 上下架与分数复核（enable / disable / flagged 裁决）</li>
 * </ul>
 * 平台管理员（JWT pa=true）恒放行；中心不可达时降级用旧快照，无旧快照按最小权限（403）。
 */
@RestController
@RequestMapping("/api/admin")
public class AdminController {

    private static final Logger log = LoggerFactory.getLogger(AdminController.class);

    static final String PERM_PACKAGE = "gamevault:admin:package";
    static final String PERM_PUBLISH = "gamevault:admin:publish";
    static final String PERM_GAME_STATUS = "gamevault:admin:game-status";

    private final AdminService admin;
    private final LeaderboardApi leaderboard;
    private final GamevaultProps props;
    private final PermCache permCache;

    public AdminController(AdminService admin, LeaderboardApi leaderboard, GamevaultProps props, PermCache permCache) {
        this.admin = admin;
        this.leaderboard = leaderboard;
        this.props = props;
        this.permCache = permCache;
    }

    /** 权限点硬校（enforce-auth 开启时）：无有效令牌 401（AuthFilter 已拦，这里兜底）；无权限点 403。 */
    private void requirePerm(HttpServletRequest req, String perm) {
        if (!props.admin().enforceAuth()) {
            return; // M1 模式：只放行不拦截（01 文档 §11-4）
        }
        VerifiedToken t = AuthFilter.current(req);
        if (t == null) {
            throw ApiException.unauthorized("UNAUTHENTICATED", "需要登录（中心 JWT）");
        }
        PermCache.Snapshot s = permCache.get(t.sub(), t.pv(), t.platformAdmin());
        if (!s.has(perm)) {
            log.info("RBAC 拒绝 sub={} perm={}", t.sub(), perm);
            throw ApiException.forbidden("FORBIDDEN", "需要权限点 " + perm);
        }
    }

    @PostMapping("/packages")
    public Map<String, String> upload(@RequestParam("file") MultipartFile file, HttpServletRequest req) throws IOException {
        requirePerm(req, PERM_PACKAGE);
        AdminService.UploadResult r = admin.upload(file);
        log.info("admin 上传 packageId={} slug={} v={}", r.packageId(), r.slug(), r.version());
        return Map.of("packageId", r.packageId(), "jobId", r.jobId(),
                "slug", r.slug(), "version", r.version(), "versionId", String.valueOf(r.versionId()));
    }

    @GetMapping("/packages/{packageId}")
    public AdminService.PackageStatus packageStatus(@PathVariable String packageId, HttpServletRequest req) {
        requirePerm(req, PERM_PACKAGE);
        return admin.packageStatus(packageId);
    }

    @PostMapping("/versions/{id}/publish")
    public Map<String, Object> publish(@PathVariable Long id, HttpServletRequest req) {
        requirePerm(req, PERM_PUBLISH);
        GameVersion v = admin.publish(id);
        return Map.of("ok", true, "versionId", v.getId(), "version", v.getVersion(), "entryUrl", v.getEntryUrl());
    }

    /** 回滚 = 对 rolled_back 版本再走一次发布（02 文档 §6.1）。 */
    @PostMapping("/versions/{id}/rollback")
    public Map<String, Object> rollback(@PathVariable Long id, HttpServletRequest req) {
        requirePerm(req, PERM_PUBLISH);
        GameVersion v = admin.publish(id);
        return Map.of("ok", true, "versionId", v.getId(), "version", v.getVersion(), "entryUrl", v.getEntryUrl());
    }

    /** M2：needsReview 人工确认（发布闸门，02 文档 §6）。 */
    @PostMapping("/versions/{id}/confirm-review")
    public Map<String, String> confirmReview(@PathVariable Long id, HttpServletRequest req) {
        requirePerm(req, PERM_PUBLISH);
        admin.confirmReview(id);
        return Map.of("ok", "true", "versionId", String.valueOf(id));
    }

    /** M2：flagged 分数复核队列（01 §6.1.5）。 */
    @GetMapping("/scores/flagged")
    public Map<String, Object> flaggedScores(@RequestParam String slug,
                                             @RequestParam(defaultValue = "50") int limit,
                                             HttpServletRequest req) {
        requirePerm(req, PERM_GAME_STATUS);
        return Map.of("scores", leaderboard.flaggedScores(slug, limit));
    }

    /** M2：复核裁决 approve → 补进总榜；reject → 维持榜外。 */
    @PostMapping("/scores/{id}/approve")
    public Map<String, String> approveScore(@PathVariable Long id, HttpServletRequest req) {
        requirePerm(req, PERM_GAME_STATUS);
        leaderboard.resolveFlagged(id, true);
        return Map.of("ok", "true", "scoreId", String.valueOf(id), "decision", "approved");
    }

    @PostMapping("/scores/{id}/reject")
    public Map<String, String> rejectScore(@PathVariable Long id, HttpServletRequest req) {
        requirePerm(req, PERM_GAME_STATUS);
        leaderboard.resolveFlagged(id, false);
        return Map.of("ok", "true", "scoreId", String.valueOf(id), "decision", "rejected");
    }

    @PostMapping("/games/{slug}/disable")
    public Map<String, String> disable(@PathVariable String slug, HttpServletRequest req) {
        requirePerm(req, PERM_GAME_STATUS);
        admin.disable(slug);
        return Map.of("ok", "true", "slug", slug, "status", "disabled");
    }

    @PostMapping("/games/{slug}/enable")
    public Map<String, String> enable(@PathVariable String slug, HttpServletRequest req) {
        requirePerm(req, PERM_GAME_STATUS);
        admin.enable(slug);
        return Map.of("ok", "true", "slug", slug, "status", "enabled");
    }

    @GetMapping("/games")
    public Map<String, Object> listGames(HttpServletRequest req) {
        requirePerm(req, PERM_GAME_STATUS);
        return Map.of("games", admin.listAll());
    }
}
