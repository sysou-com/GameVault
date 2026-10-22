package com.sysou.gamevault.common.props;

import org.springframework.boot.context.properties.ConfigurationProperties;

/** 平台运行参数（application.yml `gamevault.*`；docs/design/01 §8）。 */
@ConfigurationProperties(prefix = "gamevault")
public record GamevaultProps(
        String gamesDir,
        String stagingDir,
        String archiveDir,
        NginxProbe nginxProbe,
        Jwt jwt,
        Admin admin) {

    public record NginxProbe(boolean enabled, String baseUrl) {
        public NginxProbe {
            if (baseUrl == null || baseUrl.isBlank()) baseUrl = "http://127.0.0.1";
        }
    }

    public record Jwt(String jwksUrl, String issuer, int keyTtlMin) {
        public Jwt {
            if (jwksUrl == null || jwksUrl.isBlank()) jwksUrl = "http://127.0.0.1:8093/manage/api/jwks";
            if (issuer == null) issuer = "";
            if (keyTtlMin <= 0) keyTtlMin = 60;
        }
    }

    /** M1：enforceAuth=false = 管理端点只记日志不拦截（01 文档 §11-4）；M2 中心权限点注册后恒 true。 */
    public record Admin(boolean enforceAuth) {
    }
}
