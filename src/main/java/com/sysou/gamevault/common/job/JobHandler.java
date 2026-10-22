package com.sysou.gamevault.common.job;

import java.util.Map;

/** 异步 Job 处理器（按 kind 注册；实现须幂等 —— 同 idempotencyKey 重放不得产生副作用）。 */
public interface JobHandler {

    String kind();

    /** @param payload 生产端写入的业务字段；@param idempotencyKey 幂等键（= 业务单据 id，如 packageId） */
    void handle(Map<String, String> payload, String idempotencyKey);
}
