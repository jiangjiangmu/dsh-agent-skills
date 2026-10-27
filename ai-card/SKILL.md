---
name: ai-card
description: >
  启动 DSH 并行独立卡片式 AI 团队（多 agent 同时开跑，各出一张独立卡片）。
  形态：一张张独立卡片（UUID、token、耗时、状态），互不依赖，无阶段面板，
  最终由主 agent 汇总。内置【候选池轮询降级】：与 ai-work 完全同一套机制——
  每个角色带一串候选模型逐个探活，通的放行、不通自动顺延，全失败列出清单。
  当用户调用 /ai-card 或说"派几张卡并行""多开几个分身各查各的"、
  需要广角并行扫描（多角度查证、分头调研、批量比对）时使用。
---

# AI Card — 并行独立卡片团队（轮询降级版）

当用户调用 `/ai-card` 或提出"派多个分身各查各的"需求时，**必须调用 DSH 原生 workflow 工具**，但**不串四阶段**——用 `parallel()` 一次性派出多张互相独立的卡片，每张卡是一个完整任务。

## ⚠️ 与 ai-work 的唯一区别：编排形态，机制完全相同

| | ai-work | ai-card |
|---|---|---|
| 工具 | workflow | workflow（同一个） |
| 编排 | 四阶段串行，上段喂下段 | parallel 并行，卡片互不依赖 |
| 形态 | 阶段流水线面板 | 一张张独立卡片 |
| 角色 | 探子→策划→挑刺→裁判 | 全是平级任务卡（可混装不同角色） |
| 汇总 | 裁判官终审 | **主 agent（我）汇总** |
| **轮询降级** | **同一套 runWithFallback** | **同一套 runWithFallback** |

**禁止用 `subagent` 工具替代**：subagent 不能指定 provider/model，候选池降级在它身上做不了。独立卡片本来就是 workflow 里 agent() 调用的产物——每次 agent() 调用就在面板出一张卡。

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

## 并行卡片骨架（一波全派出，互不依赖）

```javascript
phase("并行卡片批次：多角度同时开跑");

// 一波派出 N 张卡，每张一个独立角度/任务
const cards = await parallel([
  () => runWithFallback(
    "你是XX角度查证卡。任务：……",
    { label: "卡1-角度A", phase: "并行批次" }, POOL.scout
  ),
  () => runWithFallback(
    "你是XX角度查证卡。任务：……",
    { label: "卡2-角度B", phase: "并行批次" }, POOL.scout
  ),
  () => runWithFallback(
    "你是XX角度查证卡。任务：……",
    { label: "卡3-角度C", phase: "并行批次" }, POOL.scout
  )
]);

// 卡片之间无输入输出依赖；主 agent（我）拿全部卡的返回做最终汇总
```

**编排规则**：
1. 每张卡的 prompt 必须**自包含**（背景+任务+边界+交付四要素），卡片之间不共享上下文
2. 卡片数量按任务角度定：2–6 张常用，重大课题可到 8–10 张
3. 可用 `parallel()` 分批：如先并行 3 张侦察卡，再并行 2 张挑刺卡（挑刺卡的输入由主 agent 从第一批结果中摘出拼接，不经过策划官）
4. **主 agent 承担终审**：所有卡回来后，由我仲裁矛盾、补全缺口、出最终结论

## 交付时必须汇报「模型体检报告」

汇报要求以契约第七节为准（每张卡 `used` + `failures`）。本技能卡片键按实际卡号（卡1/卡2/…）。

```javascript
return {
  cardCount: cards.length,
  modelHealthReport: {
    卡1: { used: cards[0].used, failed: cards[0].failures },
    卡2: { used: cards[1].used, failed: cards[1].failures },
    卡3: { used: cards[2].used, failed: cards[2].failures }
  },
  cardResults: cards.map(c => c.text),
  mainAgentSynthesis: "由主 agent 汇总的最终结论"
};
```

## 适用场景

- 多角度并行查证（"同时查供应商真假、价格行情、市场口碑"）
- 分头调研（"三个卡分别查北美/欧洲/东南亚市场"）
- 批量比对（"五张卡各审一个方案，回来横向比"）
- 用户明确要"一张张独立卡片"形态时

成本参考：每张卡约 5–20 万 token（看任务深度）；账号 503 时失败卡增多，需先确认余额。
