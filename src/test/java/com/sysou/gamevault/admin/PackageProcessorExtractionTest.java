package com.sysou.gamevault.admin;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * zip-slip 判定回归（Windows Path 陷阱：
 * Path.of("./x") 保留 "." 前缀而 normalize() 移除 → 直接 startsWith 会误报，
 * 真实游戏包 reflex-rush 的 assets/ 子目录在 2026-10-23 部署前暴露）。
 */
class PackageProcessorExtractionTest {

    @ParameterizedTest
    @ValueSource(strings = {"index.html", "assets/main-a1.js", "godot/engine.wasm", "a/b/c.png"})
    void packageInternalPathsAreSafe(String name) {
        // 带 "./" 前缀的 gamesDir（dev 默认形态）
        assertTrue(PackageProcessor.isSafeExtraction(Path.of("./data/games", "s", "v.tmp"), name), name);
        // 绝对路径形态
        assertTrue(PackageProcessor.isSafeExtraction(Path.of("/var/www/gamevault/games/s/v.tmp"), name), name);
        // Windows 形态
        assertTrue(PackageProcessor.isSafeExtraction(Path.of("D:\\www\\games\\s\\v.tmp"), name), name);
    }

    @ParameterizedTest
    @ValueSource(strings = {"../evil.js", "../../etc/passwd", "..\\evil.js", "/etc/passwd"})
    void escapingPathsAreRejected(String name) {
        assertFalse(PackageProcessor.isSafeExtraction(Path.of("./data/games", "s", "v.tmp"), name), name);
        assertFalse(PackageProcessor.isSafeExtraction(Path.of("/var/www/gamevault/games/s/v.tmp"), name), name);
    }

    @Test
    void absoluteWindowsPathIsRejected() {
        // 绝对路径 entry：resolve 会直接跳到该绝对路径 → 不在 base 下
        assertFalse(PackageProcessor.isSafeExtraction(Path.of("D:\\www\\games\\s\\v.tmp"), "C:\\Windows\\evil.js"));
    }
}
