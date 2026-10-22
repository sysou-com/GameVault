package com.sysou.gamevault.admin;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import static org.junit.jupiter.api.Assertions.*;

/** 游戏包校验器单测（02 文档 §6 规则逐项覆盖）。 */
class PackageValidatorTest {

    private PackageValidator validator;

    @BeforeEach
    void setUp() {
        validator = new PackageValidator(new ObjectMapper());
    }

    private static byte[] zip(Map<String, String> files) throws Exception {
        var bos = new ByteArrayOutputStream();
        try (var zos = new ZipOutputStream(bos)) {
            files.forEach((name, content) -> {
                try {
                    zos.putNextEntry(new ZipEntry(name));
                    zos.write(content.getBytes(StandardCharsets.UTF_8));
                    zos.closeEntry();
                } catch (Exception e) {
                    throw new RuntimeException(e);
                }
            });
        }
        return bos.toByteArray();
    }

    private static String manifest(String game) {
        return """
                {"schema":"gamevault/manifest@1","game":"%s","version":"1.0.0","title":"测试",
                 "engine":"canvas-native","language":"typescript","entry":"index.html","cover":"cover.png",
                 "size":{"totalBytes":1234,"initialLoadBytes":100},
                 "score":{"enabled":true,"range":[0,9999]}}
                """.replace("%s", game);
    }

    @Test
    void validPackagePasses() throws Exception {
        byte[] z = zip(Map.of(
                "manifest.json", manifest("demo"),
                "index.html", "<html><body>ok</body></html>",
                "main.js", "console.log('hi')",
                "img.png", "x"));
        PackageValidator.Result r = validator.validate(new ByteArrayInputStream(z), z.length);
        assertTrue(r.ok(), "应通过：" + r.report());
        assertFalse(r.needsReview());
    }

    @Test
    void missingManifestFails() throws Exception {
        byte[] z = zip(Map.of("index.html", "<html></html>"));
        PackageValidator.Result r = validator.validate(new ByteArrayInputStream(z), z.length);
        assertFalse(r.ok());
        assertTrue(r.report().stream().anyMatch(s -> s.contains("manifest")));
    }

    @Test
    void nonWhitelistedExtensionRejected() throws Exception {
        byte[] z = zip(Map.of("manifest.json", manifest("demo"), "evil.exe", "MZ"));
        PackageValidator.Result r = validator.validate(new ByteArrayInputStream(z), z.length);
        assertFalse(r.ok());
        assertTrue(r.report().stream().anyMatch(s -> s.contains("ext")));
    }

    @Test
    void zipSlipRejected() throws Exception {
        byte[] z = zip(Map.of("manifest.json", manifest("demo"), "../evil.txt", "x"));
        PackageValidator.Result r = validator.validate(new ByteArrayInputStream(z), z.length);
        assertFalse(r.ok());
        assertTrue(r.report().stream().anyMatch(s -> s.contains("zip-slip")));
    }

    @Test
    void internalIpRejected() throws Exception {
        byte[] z = zip(Map.of("manifest.json", manifest("demo"), "leak.js",
                "fetch('http://192.168.1.10/admin')"));
        PackageValidator.Result r = validator.validate(new ByteArrayInputStream(z), z.length);
        assertFalse(r.ok());
        assertTrue(r.report().stream().anyMatch(s -> s.contains("security")));
    }

    @Test
    void secretTokenRejected() throws Exception {
        byte[] z = zip(Map.of("manifest.json", manifest("demo"), "leak.js",
                "const t = 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';"));
        PackageValidator.Result r = validator.validate(new ByteArrayInputStream(z), z.length);
        assertFalse(r.ok());
        assertTrue(r.report().stream().anyMatch(s -> s.contains("GitHub token")));
    }

    @Test
    void topLevelLocationRejected() throws Exception {
        byte[] z = zip(Map.of("manifest.json", manifest("demo"), "jump.js",
                "if (x) top.location = 'http://evil.example';"));
        PackageValidator.Result r = validator.validate(new ByteArrayInputStream(z), z.length);
        assertFalse(r.ok());
    }

    @Test
    void manifestMissingRequiredFieldFails() throws Exception {
        byte[] z = zip(Map.of("manifest.json", "{\"game\":\"demo\",\"version\":\"1.0.0\"}"));
        PackageValidator.Result r = validator.validate(new ByteArrayInputStream(z), z.length);
        assertFalse(r.ok());
        assertTrue(r.report().stream().anyMatch(s -> s.contains("schema")));
    }

    @Test
    void localhostInCodeRejected() throws Exception {
        byte[] z = zip(Map.of("manifest.json", manifest("demo"), "cfg.js",
                "const api = 'http://localhost:8094/internal';"));
        PackageValidator.Result r = validator.validate(new ByteArrayInputStream(z), z.length);
        assertFalse(r.ok());
    }
}
