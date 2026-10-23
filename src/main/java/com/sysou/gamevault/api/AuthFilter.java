package com.sysou.gamevault.api;

import com.sysou.gamevault.common.props.GamevaultProps;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/**
 * 中心 JWT 过滤器（01 文档 §7；M2 起启用登录门禁）。
 *
 * <p>分层行为：
 * <ul>
 *   <li><b>登录必选</b>（M2 红线：提分/我的数据只认登录态）：/api/scores、/api/me/** ——
 *       无有效中心 JWT 一律 401（不再受 enforce-auth 开关影响）。</li>
 *   <li><b>管理端点</b>：/api/admin/** —— `admin.enforce-auth=true`（M2 生产恒 true）时
 *       未验证令牌 401；权限点级 RBAC（gamevault:admin:*）在中心注册后按权限点细校。</li>
 *   <li>其余 /api/**：携带 Bearer 时验签 + 记日志并挂 attribute（公开端点可选识别登录态）。</li>
 * </ul>
 */
@Component
public class AuthFilter extends OncePerRequestFilter {

    public static final String ATTR = "gamevault.verifiedToken";
    private static final Logger log = LoggerFactory.getLogger(AuthFilter.class);

    private final JwtVerifier verifier;
    private final GamevaultProps props;

    public AuthFilter(JwtVerifier verifier, GamevaultProps props) {
        this.verifier = verifier;
        this.props = props;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !request.getRequestURI().startsWith("/api/");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse resp, FilterChain chain)
            throws ServletException, IOException {
        String uri = req.getRequestURI();
        boolean needLogin = uri.equals("/api/scores") || uri.startsWith("/api/me/");
        String token = bearer(req);
        JwtVerifier.VerifiedToken t = null;
        if (token != null) {
            try {
                t = verifier.verify(token);
                req.setAttribute(ATTR, t);
                log.info("auth ok sub={} roles={}", t.sub(), t.roles());
            } catch (Exception e) {
                log.warn("auth 令牌验签失败: {}", e.getMessage());
            }
        }
        if (t == null && needLogin) {
            writeUnauthorized(resp, "需要登录（中心令牌缺失或无效）");
            return;
        }
        if (t == null && uri.startsWith("/api/admin/") && props.admin().enforceAuth()) {
            writeUnauthorized(resp, "中心令牌无效或缺失");
            return;
        }
        chain.doFilter(req, resp);
    }

    private void writeUnauthorized(HttpServletResponse resp, String message) throws IOException {
        resp.setStatus(401);
        resp.setContentType("application/json; charset=utf-8");
        resp.getWriter().write("{\"error\":{\"code\":\"UNAUTHORIZED\",\"message\":\"" + message + "\"}}");
    }

    private static String bearer(HttpServletRequest req) {
        String h = req.getHeader("Authorization");
        return h != null && h.startsWith("Bearer ") ? h.substring(7).trim() : null;
    }

    public static JwtVerifier.VerifiedToken current(HttpServletRequest req) {
        Object o = req.getAttribute(ATTR);
        return o instanceof JwtVerifier.VerifiedToken t ? t : null;
    }
}
