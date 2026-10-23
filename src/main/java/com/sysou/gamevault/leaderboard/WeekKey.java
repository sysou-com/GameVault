package com.sysou.gamevault.leaderboard;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.WeekFields;

/**
 * 周榜时间桶（ISO 周，如 2026-43）：key = lb:week:&lt;slug&gt;:&lt;yyyy-Ww&gt;（01 文档 §3/§6.1）。
 *
 * <p>每周一 00:00（服务器时区）由 LEADERBOARD_WEEK_RESET Job 归档上周 key、开新桶（惰性——
 * 新桶无需显式创建，ZADD 自然建 key）。
 */
public final class WeekKey {

    private WeekKey() {
    }

    public static String current(Instant now) {
        return of(now.atZone(ZoneId.systemDefault()).toLocalDate());
    }

    /** 纯函数形式（测试用）：给定日期算 ISO 周桶。 */
    public static String of(LocalDate date) {
        int week = date.get(WeekFields.ISO.weekOfWeekBasedYear());
        return date.get(WeekFields.ISO.weekBasedYear()) + "-" + String.format("%02d", week);
    }

    /** 上周一时刻（周榜归档 Job 用：now-7d 落在上一桶）。 */
    public static String previous(Instant now) {
        return current(now.minus(Duration.ofDays(7)));
    }
}
