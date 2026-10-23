package com.sysou.gamevault.leaderboard;

import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;

import static org.junit.jupiter.api.Assertions.*;

/** 周榜时间桶（ISO 周）纯函数测试。 */
class WeekKeyTest {

    @Test
    void isoWeekBuckets() {
        // 2026-10-19 是周一 → ISO 2026-W43（周一 00:00 换桶的锚点）
        assertEquals("2026-43", WeekKey.of(LocalDate.of(2026, 10, 19)));
        assertEquals("2026-43", WeekKey.of(LocalDate.of(2026, 10, 25)));   // 同周（周日）
        assertEquals("2026-44", WeekKey.of(LocalDate.of(2026, 10, 26)));   // 下一周一
    }

    @Test
    void weekBasedYearDiffersFromCalendarYear() {
        // 2027-01-01 是周五，属 ISO 2026-W53（跨年周按周基年）
        assertEquals("2026-53", WeekKey.of(LocalDate.of(2027, 1, 1)));
    }

    @Test
    void previousIsSevenDaysAgoBucket() {
        Instant mon = LocalDate.of(2026, 10, 26).atStartOfDay(ZoneId.systemDefault()).toInstant();
        assertEquals("2026-43", WeekKey.previous(mon));
        assertEquals("2026-44", WeekKey.current(mon));
    }
}
