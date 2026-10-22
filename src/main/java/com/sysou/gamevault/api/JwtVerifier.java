package com.sysou.gamevault.api;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sysou.gamevault.common.props.GamevaultProps;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.JwtParserBuilder;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

import java.security.KeyFactory;
import java.security.spec.ECParameterSpec;
import java.security.spec.ECPublicKeySpec;
import java.security.interfaces.ECPublicKey;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 中心 JWT 验签（sysou-manage ES256 / EC P-256 + JWKS；01 文档 §7）。
 *
 * <p>M1 用途：验签 + 记日志（不拦截）；M2 起：admin 端点拦截 + 权限点校验。
 * JWKS 拉取失败不缓存坏结果（5s 内重试），避免中心重启窗口把全平台打 401。
 */
@Service
public class JwtVerifier {

    private static final Logger log = LoggerFactory.getLogger(JwtVerifier.class);
    private static final int CACHE_TTL_MS_DEFAULT = 60 * 60 * 1000;

    private final GamevaultProps.Jwt props;
    private final RestClient http;
    private final ObjectMapper mapper;
    private final Map<String, CachedKey> keys = new ConcurrentHashMap<>();
    private long fetchFailedAt;

    public JwtVerifier(GamevaultProps props, ObjectMapper mapper) {
        this.props = props.jwt();
        this.mapper = mapper;
        this.http = RestClient.create();
    }

    public record VerifiedToken(String sub, String email, List<String> roles, boolean platformAdmin) {
    }

    public VerifiedToken verify(String token) {
        // 从 JWT header（base64url 首段）取 kid —— 不解签名不依赖验签 API 行为
        String kid;
        try {
            String[] parts = token.split("\\.");
            if (parts.length < 3) throw new IllegalArgumentException("非 JWT 格式");
            String header = new String(Base64.getUrlDecoder().decode(parts[0]), java.nio.charset.StandardCharsets.UTF_8);
            kid = mapper.readTree(header).path("kid").asText("");
            if (kid.isBlank()) throw new IllegalArgumentException("header 无 kid");
        } catch (Exception e) {
            throw new com.sysou.gamevault.common.api.ApiException("UNAUTHORIZED", org.springframework.http.HttpStatus.UNAUTHORIZED, "令牌不可解析");
        }
        ECPublicKey key = keyFor(kid);
        JwtParserBuilder parser = Jwts.parser().verifyWith(key);
        if (!props.issuer().isBlank()) {
            parser = parser.requireIssuer(props.issuer());
        }
        Claims c = parser.build().parseClaimsJws(token).getPayload();
        @SuppressWarnings("unchecked")
        List<String> roles = c.get("roles", List.class);
        Boolean pa = c.get("pa", Boolean.class);
        return new VerifiedToken(c.getSubject(), c.get("email", String.class),
                roles != null ? roles : List.of(), Boolean.TRUE.equals(pa));
    }

    private ECPublicKey keyFor(String kid) {
        CachedKey ck = keys.get(kid);
        long now = System.currentTimeMillis();
        if (ck != null && ck.expiresAt > now) {
            return ck.key;
        }
        JsonNode jwks = fetchJwks();
        JsonNode k = findKey(jwks, kid);
        if (k == null) {
            throw new IllegalStateException("JWKS 中无 kid=" + kid + "（中心密钥轮换？等待 JWKS 刷新）");
        }
        ECPublicKey key = parseEcKey(k);
        keys.put(kid, new CachedKey(key, now + ttlMs()));
        return key;
    }

    private JsonNode fetchJwks() {
        long now = System.currentTimeMillis();
        if (now - fetchFailedAt < 5_000) {
            throw new IllegalStateException("JWKS 拉取失败中（5s 内不重试）");
        }
        try {
            String body = http.get().uri(props.jwksUrl()).retrieve().body(String.class);
            JsonNode root = mapper.readTree(body);
            return root.path("keys");
        } catch (Exception e) {
            fetchFailedAt = now;
            log.warn("JWKS 拉取失败 {}: {}", props.jwksUrl(), e.toString());
            throw new IllegalStateException("JWKS 拉取失败", e);
        }
    }

    private JsonNode findKey(JsonNode keys, String kid) {
        if (keys == null || !keys.isArray()) return null;
        for (JsonNode k : keys) {
            if (kid.equals(k.path("kid").asText())) return k;
        }
        return null;
    }

    private ECPublicKey parseEcKey(JsonNode k) {
        try {
            ECParameterSpec spec = ecSpec256();
            byte[] x = padLeft(Base64.getUrlDecoder().decode(k.get("x").asText()), 32);
            byte[] y = padLeft(Base64.getUrlDecoder().decode(k.get("y").asText()), 32);
            java.security.spec.ECPoint point = new java.security.spec.ECPoint(
                    new java.math.BigInteger(1, x), new java.math.BigInteger(1, y));
            KeyFactory kf = KeyFactory.getInstance("EC");
            return (ECPublicKey) kf.generatePublic(new ECPublicKeySpec(point, spec));
        } catch (Exception e) {
            throw new IllegalStateException("JWKS 密钥解析失败 kid=" + k.path("kid").asText(), e);
        }
    }

    private static ECParameterSpec ecSpec256() {
        try {
            java.security.AlgorithmParameters ap = java.security.AlgorithmParameters.getInstance("EC");
            ap.init(new java.security.spec.ECGenParameterSpec("secp256r1"));
            return ap.getParameterSpec(ECParameterSpec.class);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private static byte[] padLeft(byte[] b, int len) {
        if (b.length >= len) return b;
        byte[] r = new byte[len];
        System.arraycopy(b, 0, r, len - b.length, b.length);
        return r;
    }

    private int ttlMs() {
        return Math.max(60, props.keyTtlMin()) * 60 * 1000;
    }

    private record CachedKey(ECPublicKey key, long expiresAt) {
    }
}
