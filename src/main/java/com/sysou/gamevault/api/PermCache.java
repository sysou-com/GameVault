package com.sysou.gamevault.api;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sysou.gamevault.common.props.GamevaultProps;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.Map;

/**
 * 中心权限快照缓存（01 文档 §7.2，中心 §4.6 裁定 #21，与兄弟工程同款）：
 * <ul>
 *   <li>JWT {@code pv} 与缓存一致 ⇒ 直接命中（不发网络请求）；</li>
 *   <li>pv 不一致 ⇒ 回源 {@code GET /manage/internal/perms?app=gamevault&sub=…}（X-Internal-Token，仅回环）；</li>
 *   <li>回源失败 ⇒ 用旧快照降级（中心不可达不打挂业务），无旧快照 ⇒ 空集（最小权限）；</li>
 *   <li>平台管理员（JWT pa=true）恒旁路（中心 pa 分支本就返回全量）。</li>
 * </ul>
 * 注意：权限点硬校由 AdminController 的 {@code requirePerm} 执行（enforce-auth 开启时）；
 * 本缓存只负责「拿快照」，不直接产生 403。
 */
@Service
public class PermCache {

    /** 单账号权限快照（中心 §4.6：{pv, perms, dataScope, pa}；数据范围 M2 未用，只存 pa/perms）。 */
    public record Snapshot(long pv, Set<String> perms, boolean pa) {
        public boolean has(String perm) {
            return pa || perms.contains(perm);
        }
    }

    private final GamevaultProps.Jwt jwt;
    private final ObjectMapper mapper;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    private final Map<String, Snapshot> cache = new ConcurrentHashMap<>();

    public PermCache(GamevaultProps props, ObjectMapper mapper) {
        this.jwt = props.jwt();
        this.mapper = mapper;
    }

    /** 取快照（缓存/回源/降级，见类注释）。 */
    public Snapshot get(String sub, long jwtPv, boolean jwtPa) {
        if (jwtPa) {
            return new Snapshot(jwtPv, Set.of(), true);
        }
        Snapshot cur = cache.get(sub);
        if (cur != null && cur.pv() == jwtPv) {
            return cur;
        }
        Snapshot fresh = fetch(sub, jwtPv);
        if (fresh != null) {
            cache.put(sub, fresh);
            return fresh;
        }
        return cur != null ? cur : new Snapshot(jwtPv, Set.of(), false);
    }

    /** 回源中心；未接入（无内部令牌）/ 中心不可达 / 响应异常 ⇒ null（调用方降级）。 */
    private Snapshot fetch(String sub, long requestedPv) {
        if (jwt.internalToken() == null || jwt.internalToken().isBlank()) {
            return null;
        }
        try {
            String url = jwt.permsUrl() + "?app=gamevault&sub=" + URLEncoder.encode(sub, StandardCharsets.UTF_8);
            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(url))
                    .timeout(Duration.ofSeconds(5))
                    .header("X-Internal-Token", jwt.internalToken())
                    .GET()
                    .build();
            HttpResponse<String> resp = http.send(req, HttpResponse.BodyHandlers.ofString());
            if (resp.statusCode() != 200) {
                return null;
            }
            JsonNode n = mapper.readTree(resp.body());
            long pv = n.path("pv").asLong(requestedPv);
            Set<String> perms = new LinkedHashSet<>();
            n.path("perms").forEach(e -> perms.add(e.asText()));
            return new Snapshot(pv, perms, n.path("pa").asBoolean(false));
        } catch (Exception e) {
            return null;
        }
    }
}
