package com.sysou.gamevault.admin;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Component;

import java.util.HashSet;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * 游戏包校验器（02 文档 §6.2–6.4 的纯逻辑实现，单测全覆盖，不触 Redis/FS）。
 *
 * <p>输入 = zip 字节流；输出 = 校验报告（逐项：ruleId + 文件 + 原因）。
 * 拒绝项（reject）直接判失败；审查项（review）标记 needsReview（发布按钮禁用直至管理台确认，M2 细化）。
 */
@Component
public class PackageValidator {

    /** 允许扩展名白名单（02 文档 §3.2）。 */
    public static final Set<String> ALLOWED_EXTENSIONS = Set.of(
            "html", "js", "mjs", "css", "json", "wasm", "pck",
            "png", "jpg", "jpeg", "webp", "gif", "svg", "ico",
            "otf", "ttf", "woff", "woff2",
            "mp3", "ogg", "wav", "m4a",
            "xml", "txt", "map");

    public static final int MAX_FILES = 5000;
    /** 单文件安全扫描上限（更大的文本文件只查结构不查内容）。 */
    private static final int SCAN_LIMIT = 2 * 1024 * 1024;

    /** 安全扫描规则（02 文档 §6.3）：命中即拒收。 */
    private static final Pattern[] REJECT_PATTERNS = {
            Pattern.compile("document\\.domain\\s*="),                                   // R1 改域
            Pattern.compile("top\\.location"),                                            // R2 顶层跳转
            Pattern.compile("\\b(10\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}"                       // R3 内网地址
                    + "|192\\.168\\.\\d{1,3}\\.\\d{1,3}"
                    + "|172\\.(1[6-9]|2[0-9]|3[01])\\.\\d{1,3}\\.\\d{1,3}"
                    + "|169\\.254\\.\\d{1,3}\\.\\d{1,3}"
                    + "|127\\.\\d{1,3}\\.\\d{1,3}|localhost)\\b"),
            Pattern.compile("AKIA[0-9A-Z]{16}"),                                          // R4 AWS key
            Pattern.compile("-----BEGIN [A-Z ]*PRIVATE KEY-----"),                        // R5 私钥
            Pattern.compile("ghp_[A-Za-z0-9]{20,}"),                                      // R6 GitHub token
            Pattern.compile("xox[baprs]-[A-Za-z0-9-]{10,}"),                              // R7 Slack token
    };
    private static final String[] REJECT_NAMES = {
            "document.domain 修改", "top.location 顶层跳转", "内网地址特征",
            "AWS 密钥特征", "私钥特征", "GitHub token 特征", "Slack token 特征",
    };

    private final ObjectMapper mapper;

    public PackageValidator(ObjectMapper mapper) {
        this.mapper = mapper;
    }

    /** 校验结果。 */
    public record Result(boolean ok, boolean needsReview, java.util.List<String> report) {
        public static Result passed() { return new Result(true, false, java.util.List.of()); }
    }

    /** 流式扫描 zip（不落地）：结构 + manifest + 安全规则。 */
    public Result validate(java.io.InputStream zip, long totalBytes) throws java.io.IOException {
        var report = new java.util.ArrayList<String>();
        boolean needsReview = false;
        if (totalBytes > 100L * 1024 * 1024) {
            report.add("size: 包超过 100MB 上限（" + totalBytes + " bytes）");
            return new Result(false, false, report);
        }
        Set<String> seen = new HashSet<>();
        JsonNode manifest = null;
        int count = 0;

        try (var zin = new java.util.zip.ZipInputStream(
                new java.io.BufferedInputStream(zip), java.nio.charset.StandardCharsets.UTF_8)) {
            java.util.zip.ZipEntry e;
            while ((e = zin.getNextEntry()) != null) {
                count++;
                String name = e.getName();
                if (e.isDirectory()) {
                    if (name.startsWith("/")) report.add("zip-slip: 目录绝对路径 " + name);
                    zin.closeEntry();
                    continue;
                }
                // zip-slip：归一化后必须在包内（02 文档 §6.2）
                String norm = name.replace('\\', '/');
                if (norm.startsWith("/") || norm.contains("..") || isAbsoluteWindows(norm)) {
                    report.add("zip-slip: 非法路径 " + name);
                    continue;
                }
                String base = norm.substring(norm.lastIndexOf('/') + 1).toLowerCase();
                String ext = base.contains(".") ? base.substring(base.lastIndexOf('.') + 1) : "";
                if (!ALLOWED_EXTENSIONS.contains(ext)) {
                    report.add("ext: 非白名单扩展名 " + name);
                    zin.closeEntry();
                    continue;
                }
                if (count > MAX_FILES) {
                    report.add("files: 超过 5000 文件上限");
                    return new Result(false, false, report);
                }
                // 内容读取（同时做大小检查 + 文本扫描）
                long size = 0;
                var buf = new byte[64 * 1024];
                var text = new java.io.ByteArrayOutputStream();
                boolean textFile = ext.equals("html") || ext.equals("js") || ext.equals("mjs")
                        || ext.equals("json") || ext.equals("css") || ext.equals("xml") || ext.equals("txt");
                int n;
                while ((n = zin.read(buf)) > 0) {
                    size += n;
                    if (size > 100L * 1024 * 1024) {
                        report.add("size: 单文件超过 100MB " + name);
                        return new Result(false, false, report);
                    }
                    if (textFile && text.size() < SCAN_LIMIT) {
                        int take = (int) Math.min(n, SCAN_LIMIT - text.size());
                        text.write(buf, 0, take);
                    }
                }
                if (!textFile && size > 50L * 1024 * 1024) {
                    report.add("review: 可疑大文件 " + name + "（" + size + " bytes）需人工确认");
                    needsReview = true;
                }
                if (textFile && "manifest.json".equals(norm)) {
                    manifest = parse(text.toString(java.nio.charset.StandardCharsets.UTF_8), report);
                }
                if (textFile) {
                    scanText(norm, text.toString(java.nio.charset.StandardCharsets.UTF_8), report);
                }
                seen.add(norm);
                zin.closeEntry();
            }
        }
        if (count > MAX_FILES) {
            report.add("files: 超过 5000 文件上限");
            return new Result(false, needsReview, report);
        }
        if (manifest == null) {
            report.add("manifest: 缺少根目录 manifest.json 或不可解析");
        }
        int rejects = 0;
        for (String s : report) {
            if (!s.startsWith("review:")) rejects++;
        }
        return new Result(rejects == 0 && manifest != null, needsReview, report);
    }

    private boolean isAbsoluteWindows(String norm) {
        return norm.length() > 1 && norm.charAt(1) == ':' && norm.charAt(0) >= 'A' && norm.charAt(0) <= 'Z';
    }

    private JsonNode parse(String raw, java.util.List<String> report) {
        try {
            JsonNode m = mapper.readTree(raw);
            for (String req : new String[]{"schema", "game", "version", "title", "engine", "entry", "cover"}) {
                if (m.path(req).isMissingNode() || m.path(req).asText("").isBlank()) {
                    report.add("manifest: 缺必填字段 " + req);
                }
            }
            JsonNode size = m.path("size");
            for (String f : new String[]{"totalBytes", "initialLoadBytes"}) {
                if (!size.path(f).isNumber() || size.path(f).asLong() < 0) {
                    report.add("manifest: size." + f + " 必须为非负整数");
                }
            }
            return m;
        } catch (Exception ex) {
            report.add("manifest: JSON 解析失败 " + ex.getMessage());
            return null;
        }
    }

    private void scanText(String name, String content, java.util.List<String> report) {
        for (int i = 0; i < REJECT_PATTERNS.length; i++) {
            if (REJECT_PATTERNS[i].matcher(content).find()) {
                report.add("security[" + REJECT_NAMES[i] + "]: " + name);
            }
        }
    }
}
