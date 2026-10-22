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
 * 中心 JWT 过滤器（01 文档 §7）。
 *
 * <p>M1 行为：对 /api/** 请求携带 Bearer 令牌时**验签 + 记日志**（身份挂 request attribute
 * {@link #ATTR}），不拦截任何端点；管理端点拦截在 M2 中心注册 gamevault 权限点后由
 * {@code admin.enforce-auth=true} 开启（未验证令牌 → 401）。
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
        String token = bearer(req);
        if (token != null) {
            try {
                JwtVerifier.VerifiedToken t = verifier.verify(token);
                req.setAttribute(ATTR, t);
                log.info("auth ok sub={} roles={}", t.sub(), t.roles());
            } catch (Exception e) {
                boolean enforceAdmin = req.getRequestURI().startsWith("/api/admin/") && props.admin().enforceAuth();
                if (enforceAdmin) {
                    resp.setStatus(401);
                    resp.setContentType("application/json; charset=utf-8");
                    resp.getWriter().write("{\"error\":{\"code\":\"UNAUTHORIZED\",\"message\":\"中心令牌无效或缺失\"}}");
                    return;
                }
                log.warn("auth 令牌验签失败（M1 放行 + 记录）: {}", e.getMessage());
            }
        }
        chain.doFilter(req, resp);
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
