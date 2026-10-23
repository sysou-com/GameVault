package com.sysou.gamevault.achievement;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sysou.gamevault.achievement.entity.AchievementDef;
import com.sysou.gamevault.achievement.entity.AchievementGrant;
import com.sysou.gamevault.achievement.repo.AchievementDefRepository;
import com.sysou.gamevault.achievement.repo.AchievementGrantRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.List;

/** 成就定义维护 + 求值发放（01 文档 §6.2；判定在服务端，客户端不可自报）。 */
@Service
public class AchievementService implements AchievementApi {

    private static final Logger log = LoggerFactory.getLogger(AchievementService.class);

    private final AchievementDefRepository defs;
    private final AchievementGrantRepository grants;
    private final ObjectMapper mapper;

    public AchievementService(AchievementDefRepository defs, AchievementGrantRepository grants, ObjectMapper mapper) {
        this.defs = defs;
        this.grants = grants;
        this.mapper = mapper;
    }

    @Override
    @Transactional
    public void syncFromManifest(String gameSlug, JsonNode manifest) {
        JsonNode arr = manifest.path("achievements");
        if (!arr.isArray() || arr.isEmpty()) return; // 包内未声明 = 不动现有定义（管理台可独立维护）
        for (JsonNode a : arr) {
            String code = a.path("code").asText("");
            if (code.isBlank()) {
                log.warn("manifest.achievements 条目缺 code，跳过 slug={}", gameSlug);
                continue;
            }
            if (!AchievementRules.knownType(a.path("rule"))) {
                log.warn("成就规则类型未知（不生效）slug={} code={} rule={}", gameSlug, code, a.path("rule"));
            }
            AchievementDef d = defs.findByGameSlugAndCode(gameSlug, code).orElseGet(() -> {
                AchievementDef nd = new AchievementDef();
                nd.setGameSlug(gameSlug);
                nd.setCode(code);
                return nd;
            });
            d.setTitle(a.path("title").asText(code));
            d.setDescription(a.path("description").asText(""));
            d.setRule(a.path("rule").isMissingNode() ? "{}" : a.get("rule").toString());
            String icon = a.path("icon").asText("");
            d.setIconUrl(icon.isBlank() ? null : "/game/g/" + gameSlug + "/" + icon);
            defs.save(d);
        }
    }

    @Override
    @Transactional
    public List<String> evaluateAndGrant(String userId, String gameSlug, long score, JsonNode meta) {
        List<AchievementDef> all = defs.findByGameSlug(gameSlug);
        if (all.isEmpty()) return List.of();
        JsonNode metaNode = meta;
        List<String> unlocked = new ArrayList<>();
        for (AchievementDef d : all) {
            if (grants.existsByUserIdAndAchievementId(userId, d.getId())) continue;
            JsonNode rule;
            try {
                rule = mapper.readTree(d.getRule());
            } catch (Exception e) {
                log.warn("成就规则解析失败 id={} code={}", d.getId(), d.getCode());
                continue;
            }
            if (AchievementRules.matches(rule, score, metaNode)) {
                AchievementGrant g = new AchievementGrant();
                g.setUserId(userId);
                g.setGameSlug(gameSlug);
                g.setAchievementId(d.getId());
                grants.save(g);
                unlocked.add(d.getCode());
                log.info("成就解锁 userId={} slug={} code={}", userId, gameSlug, d.getCode());
            }
        }
        return unlocked;
    }

    @Override
    @Transactional(readOnly = true)
    public List<DefView> defs(String gameSlug) {
        return defs.findByGameSlug(gameSlug).stream()
                .map(d -> new DefView(d.getId(), d.getCode(), d.getTitle(), d.getDescription(), json(d.getRule()), d.getIconUrl()))
                .toList();
    }

    @Override
    @Transactional(readOnly = true)
    public List<GrantView> myGrants(String userId, String gameSlug) {
        java.util.Map<Long, AchievementDef> defById = defs.findByGameSlug(gameSlug).stream()
                .collect(java.util.stream.Collectors.toMap(AchievementDef::getId, java.util.function.Function.identity(), (a, b) -> a));
        return grants.findUserGameGrants(userId, gameSlug).stream()
                .map(g -> {
                    AchievementDef d = defById.get(g.getAchievementId());
                    return d == null ? null : new GrantView(d.getCode(), d.getTitle(), d.getDescription(), d.getIconUrl(), g.getGrantedAt());
                })
                .filter(java.util.Objects::nonNull)
                .toList();
    }

    private JsonNode json(String raw) {
        try {
            return mapper.readTree(raw);
        } catch (Exception e) {
            return mapper.createObjectNode();
        }
    }
}
