package com.sysou.gamevault.admin;

import com.sysou.gamevault.catalog.entity.GameVersion;
import com.sysou.gamevault.common.api.ApiException;
import com.sysou.gamevault.common.props.GamevaultProps;
import com.sysou.gamevault.leaderboard.LeaderboardApi;
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
 * <p><b>M1 鉴权状态</b>：中心 gamevault 权限点尚未注册（M2 工作），按 01 文档 §11-4「M1 可先放行 +
 * 记录」——AuthFilter 对 Bearer 令牌验签并记日志，但不拦截；`admin.enforce-auth=true`（M2 起生产恒 true）
 * 时未验证令牌访问本前缀一律 401。
 */
@RestController
@RequestMapping("/api/admin")
public class AdminController {

    private static final Logger log = LoggerFactory.getLogger(AdminController.class);

    private final AdminService admin;
    private final LeaderboardApi leaderboard;
    private final GamevaultProps props;

    public AdminController(AdminService admin, LeaderboardApi leaderboard, GamevaultProps props) {
        this.admin = admin;
        this.leaderboard = leaderboard;
        this.props = props;
    }

    @PostMapping("/packages")
    public Map<String, String> upload(@RequestParam("file") MultipartFile file) throws IOException {
        if (props.admin().enforceAuth()) {
            // M2：这里换成中心 RBAC 权限点 gamevault:admin:package 校验（AuthFilter 已挂 attributes）
        }
        AdminService.UploadResult r = admin.upload(file);
        log.info("admin 上传 packageId={} slug={} v={}", r.packageId(), r.slug(), r.version());
        return Map.of("packageId", r.packageId(), "jobId", r.jobId(),
                "slug", r.slug(), "version", r.version(), "versionId", String.valueOf(r.versionId()));
    }

    @GetMapping("/packages/{packageId}")
    public AdminService.PackageStatus packageStatus(@PathVariable String packageId) {
        return admin.packageStatus(packageId);
    }

    @PostMapping("/versions/{id}/publish")
    public Map<String, Object> publish(@PathVariable Long id) {
        GameVersion v = admin.publish(id);
        return Map.of("ok", true, "versionId", v.getId(), "version", v.getVersion(), "entryUrl", v.getEntryUrl());
    }

    /** 回滚 = 对 rolled_back 版本再走一次发布（02 文档 §6.1）。 */
    @PostMapping("/versions/{id}/rollback")
    public Map<String, Object> rollback(@PathVariable Long id) {
        GameVersion v = admin.publish(id);
        return Map.of("ok", true, "versionId", v.getId(), "version", v.getVersion(), "entryUrl", v.getEntryUrl());
    }

    /** M2：needsReview 人工确认（发布闸门，02 文档 §6）。 */
    @PostMapping("/versions/{id}/confirm-review")
    public Map<String, String> confirmReview(@PathVariable Long id) {
        admin.confirmReview(id);
        return Map.of("ok", "true", "versionId", String.valueOf(id));
    }

    /** M2：flagged 分数复核队列（01 §6.1.5）。 */
    @GetMapping("/scores/flagged")
    public Map<String, Object> flaggedScores(@RequestParam String slug,
                                             @RequestParam(defaultValue = "50") int limit) {
        return Map.of("scores", leaderboard.flaggedScores(slug, limit));
    }

    /** M2：复核裁决 approve → 补进总榜；reject → 维持榜外。 */
    @PostMapping("/scores/{id}/approve")
    public Map<String, String> approveScore(@PathVariable Long id) {
        leaderboard.resolveFlagged(id, true);
        return Map.of("ok", "true", "scoreId", String.valueOf(id), "decision", "approved");
    }

    @PostMapping("/scores/{id}/reject")
    public Map<String, String> rejectScore(@PathVariable Long id) {
        leaderboard.resolveFlagged(id, false);
        return Map.of("ok", "true", "scoreId", String.valueOf(id), "decision", "rejected");
    }

    @PostMapping("/games/{slug}/disable")
    public Map<String, String> disable(@PathVariable String slug) {
        admin.disable(slug);
        return Map.of("ok", "true", "slug", slug, "status", "disabled");
    }

    @PostMapping("/games/{slug}/enable")
    public Map<String, String> enable(@PathVariable String slug) {
        admin.enable(slug);
        return Map.of("ok", "true", "slug", slug);
    }

    @GetMapping("/games")
    public Map<String, Object> listGames() {
        return Map.of("games", admin.listAll());
    }
}
