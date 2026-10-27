---
name: ai-work
description: >
  启动 DSH 原生四阶段 AI 团队流水线（侦察 → 策划 → 挑刺 → 裁判）。
  形态：分阶段推进的工作流面板，上段输出喂下段，裁判官出终审裁决。
  内置【候选池轮询降级】：每个角色带一串候选模型，逐个探活，
  通的放行、不通自动顺延，全部失败则列出失败清单，不静默吞掉。
  当用户调用 /ai-work 或说"拉个团队验一遍""团队挑刺到底"、
  需要红蓝对抗式深度验证（重大决策、方案审查、可行性判定）时使用。
---

# AI Work — 四阶段串行团队流水线（轮询降级版）

当用户调用 `/ai-work` 或提出需要多角色团队协同、红蓝挑刺审查时，**必须直接调用 DSH 原生 workflow 工具**，启动 4 阶段串行工作流。

> 本技能与 ai-card 共用同一套「候选池 + 轮询降级」机制。
> **模型原盘、provider 修正表、组盘三硬规则、runWithFallback 源码，唯一权威版本在
> `_shared\model-pool.md` —— 本文件一律不再抄写（锁会查）。**

## ⚠️ 第 0 步：读契约（不读不开跑）

开跑前**必须先读** `_shared\model-pool.md`：

1. **体检**：按第四节读 `health-<profile>.json`（`DSH_PROFILE`：桌面 `desktop` / 网页 `web`）；
   缺失或超 6 小时 → 先跑 `_shared\health-check.mjs`。
2. **组盘**：按第四节三条硬规则当场组装——原盘原序只做减法 + 盘尾兜底 + 多盘不连坐。
3. **取码**：从第六节**原样复制** POOL 模板与 `runWithFallback()` 进 workflow 脚本。

> 🔒 **落盘铁律**：所有写文件动作（health-*.json、任何输出）**只能由主 agent 执行**；子代理只返回结果，**无文件权限**——workflow 脚本沙箱没有文件系统，结果必须交回主 agent 落盘。

**契约读不到 → 立即中止并向用户报错；禁止凭记忆组盘。**

## 核心铁律（摘要，全文见契约第一节）

**禁止硬编码单一模型，必须走「候选池 + 轮询降级」；全部候选失败必须报清单，不静默吞掉。**

## 四阶段串行骨架

```javascript
// Phase 1: 双探子并行侦察
const [scoutA, scoutB] = await parallel([
  () => runWithFallback(事实探子提示词, { label: "探子-事实", phase: "Phase 1" }, POOL.scout),
  () => runWithFallback(风险探子提示词, { label: "探子-风险", phase: "Phase 1" }, POOL.scout)
]);

// Phase 2: 策划官综合情报出草案（依赖 Phase 1 输出）
const draftRes = await runWithFallback(策划提示词 + scoutA.text + scoutB.text,
  { label: "策划官-方案草案", phase: "Phase 2" }, POOL.architect);

// Phase 3: 双挑刺官并行攻击草案（依赖 Phase 2 输出）
const [critA, critB] = await parallel([
  () => runWithFallback(技术挑刺提示词 + draft, { label: "挑刺官-技术", phase: "Phase 3" }, POOL.critic),
  () => runWithFallback(商业挑刺提示词 + draft, { label: "挑刺官-商业", phase: "Phase 3" }, POOL.critic)
]);

// Phase 4: 裁判官终审（依赖 Phase 2+3 输出）
const verdictRes = await runWithFallback(裁判提示词 + draft + critA.text + critB.text,
  { label: "裁判官-终审", phase: "Phase 4" }, POOL.judge);
```

## 交付时必须汇报「模型体检报告」

汇报要求以契约第七节为准（每角色 `used` + `failures`）。本技能角色键固定：
探子A / 探子B / 策划官 / 挑刺官A / 挑刺官B / 总裁判。

```javascript
return {
  modelHealthReport: {
    探子A: { used: scoutA.used, failed: scoutA.failures },
    探子B: { used: scoutB.used, failed: scoutB.failures },
    策划官: { used: draftRes.used, failed: draftRes.failures },
    挑刺官A: { used: critA.used, failed: critA.failures },
    挑刺官B: { used: critB.used, failed: critB.failures },
    总裁判: { used: verdictRes.used, failed: verdictRes.failures }
  },
  finalVerdict: verdictRes.text
};
```

向用户展示每个角色**实际命中的模型**与被跳过的失效模型。

## 适用场景

- 重大决策验证（可行/不可行 + 边界条件）
- 方案红蓝对抗（搜集→策划→挑刺→终审闭环）
- 需要"裁判官给最终裁决"的场合

成本参考：6 角色约 40–50 万 token；若扩编至 12 角色约 100–130 万，需先确认账号余额（503 时失败卡会增多）。
