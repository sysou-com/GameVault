package com.sysou.gamevault.common.job;

/** Job 类型（01 文档 §2.1；M1 只用 GAME_PACKAGE_PROCESS，其余 M2/M3 启用）。 */
public final class JobKinds {

    public static final String GAME_PACKAGE_PROCESS = "GAME_PACKAGE_PROCESS";
    public static final String SCORE_SETTLE = "SCORE_SETTLE";               // M2
    public static final String TELEMETRY_AGG = "TELEMETRY_AGG";             // M3
    public static final String LEADERBOARD_WEEK_RESET = "LEADERBOARD_WEEK_RESET"; // M2

    /** Redis Streams 键（db 号按环境，生产 db3）。 */
    public static final String STREAM_JOBS = "gamevault:jobs";
    public static final String STREAM_DEAD = "gamevault:dead";
    public static final String GROUP = "gamevault";

    private JobKinds() {
    }
}
