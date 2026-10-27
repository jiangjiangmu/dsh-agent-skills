# 模型候选池契约（唯一权威版本 · Single Source of Truth）

> **本文件是 ai-work 与 ai-card 共用的契约层。**
> 模型原盘、provider 修正表、组盘规则、runWithFallback 源码，只在这里维护这一份；
> 两本技能书只保留各自的编排差异，**一律不得再抄写本文件内容**（锁会查）。
> **改动本文件后，必须跑 `_shared\check-roster.mjs`（锁），通过才算改完。**

| 项 | 值 |
|---|---|
| 版本 | v2.3 |
| 生效日期 | 2026-10-27 |
| 来源 | 由 ai-work / ai-card 两本技能书的手抄本合并而成 |
| 适用 | ai-work（四阶段串行）、ai-card（并行卡片） |
| 锁 | `_shared\check-roster.mjs` |

---

## 一、核心铁律：禁止硬编码单一模型

**必须走「候选池 + 轮询降级」。**

教训（务必避免重犯）：曾因把探子模型写成不存在的 ID，导致 Phase 1 两名探子双双直接失败，整条流水线残废。

唯一正确做法：每个角色配置候选模型池，用 `runWithFallback()` **逐个轮询探活**：

- 调用成功且返回非空 → **立即放行，记录命中模型**；
- 返回 null / 抛错 / 空字符串 → 记一笔失败，**自动顺延下一个候选**；
- 全部候选都失败 → 明确记录失败原因清单，**不静默吞掉**。

## 二、候选模型原盘（机读块，唯一源）

```pool
scout:     agnes/agnes-3.0-flash, gemini/gemini-3.8-flash-high, gemini/gemini-3.6-flash-high, work/gemini-3.6-flash-high
architect: gemini/gemini-3.7-flash-high, work/gemini-3.7-flash-high, agnes/agnes-3.0-flash, work/claude-opus-4-6-thinking
critic:    gemini/gemini-3.7-flash-high, work/gemini-3.7-flash-high, work/claude-sonnet-4-6, agnes/agnes-3.0-flash
judge:     stepfun/step-5-preview, stepfun01/step-5-preview, work/claude-opus-4-6-thinking, gemini/claude-opus-4-6-thinking, agnes/agnes-3.0-flash
```

> 上面这个 `pool` 块是原盘的**唯一源**：顺序不可变，只做减法。
> 锁脚本按它解析；**任何其他文件出现模型名单都算违规**（手抄本回潮）。

## 三、provider 修正表

原盘里的旧 provider 名在本机已不存在，按模型名落到真实 provider：

| 旧名 | 本机真实 provider | 说明 |
| :--- | :--- | :--- |
| `agnes` | `agent2api` | `agnes-3.0-flash` 挂在 agent2api 下 |
| `work` | `agent2api`／`gemini` | 按模型名找；找不到同名模型即视为该位置已死 |
| `stepfun` | 桌面 `agent2api`／网页 `stepfun` | `step-5-preview` 两条路都有 |
| `stepfun01` | — | 不存在，该位置必死 |

## 四、开跑前体检与组盘（每次拉起都要做）

1. **读体检结果**：`_shared\health-<profile>.json`（`<profile>` 取当前实例的 `DSH_PROFILE` 环境变量：桌面 `desktop`，网页 `web`）。
   文件缺失或 `generatedAt` 早于 6 小时 → 先按 `_shared\health-check.mjs` 重跑一遍体检。
2. **组盘**（三条硬规则，用户定死，不许自作主张重排）：
   - **原盘原序，只做减法**：原盘成员按原顺序保留；体检里 `ok:false` 的划掉，**不补位、不重排**。
   - **盘尾兜底**：体检里 `ok:true`、但原本不在任何一个盘里的模型，按 profile 配置里的原始出现顺序，
     追加到**每个盘的盘尾**。只有原盘的人全死光才轮到，**绝不插队、绝不顶替**。
   - **同一个模型在多个盘里各判各的，不连坐**；四个盘两本书共用，兜底只追加一次。
3. **落盘 + 开跑**：把组好的池子代入下面的 `POOL`，照常跑各自编排，结尾照旧报「模型体检报告」。

## 五、执行流程（三段，每次拉起都照这个走）

每次拉起 `/ai-work` 或 `/ai-card`，**按顺序走三段，不许颠倒、不许跳过**：

| 阶段 | 动作 | 产出 | 发现「不可用」怎么办 |
|---|---|---|---|
| ① **体检** | 读 `health-<profile>.json`；缺失或距今 > 6 小时 → 先跑 `_shared\health-check.mjs` | 谁活谁死的地图 | 死模型在组盘阶段被划掉 |
| ② **组盘** | 按第四节三条硬规则组装 POOL | 组好的候选池 | 体检 `ok:false` 的**不进池** |
| ③ **轮询降级** | 用第六节 `runWithFallback()` 逐个尝试 POOL 成员 | 命中模型 + 失败清单 | 空返回 / 报错 → 记 failures → **顺延下一个**；全灭 → **报完整清单，不静默** |

要点：

- **组盘 = 预裁**：只留体检「活」的原盘成员 + 盘尾兜底；体检没探到（UNKNOWN）的成员**不确定可用**，交给下一步终裁。
- **轮询降级 = 终裁**：哪怕某成员在体检后刚死，运行时也会立刻抓到、顺延，**绝不让它堵在盘头**。
- 每一步都记 `log`，交付时汇总「模型体检报告」（见第七节）。

> ## 🔒 落盘铁律（用户定死，写入契约）
> **所有写文件动作（health-*.json、任何输出）只能由主 agent 执行；子代理只返回结果，无文件权限。**
> 原因：workflow 脚本沙箱没有文件系统权限——子代理根本没有落盘能力，结果必须交回主 agent 落盘，否则结果拿不到。

开跑例行对照（每次都要打勾）：

- [ ] 契约 `model-pool.md` 已读（读到才组盘，不许凭记忆）
- [ ] 体检新鲜（`health-*.json` 距今 ≤ 6 小时）
- [ ] POOL = 原盘只做减法 + 盘尾兜底，**没有抄写名单**
- [ ] 结尾交了「模型体检报告」（每角色/卡片 `used` + `failures`）

## 六、POOL 模板与 runWithFallback（唯一权威源码）

```javascript
// ⚠️ POOL 不写死在这里 —— 开跑前按「原盘原序 + 盘尾兜底」当场组装后填进来。
//    provider 一律用本机真实名：gemini / agent2api / antling（网页版另有 stepfun）。
const POOL = {
  scout:     [ /* 原盘 4 个去死 → 再追加盘尾兜底 */ ],
  architect: [ /* 原盘 4 个去死 → 再追加盘尾兜底 */ ],
  critic:    [ /* 原盘 4 个去死 → 再追加盘尾兜底 */ ],
  judge:     [ /* 原盘 5 个去死 → 再追加盘尾兜底 */ ]
};

async function runWithFallback(prompt, opts, pool) {
  const failures = [];
  for (const c of pool) {
    const tag = c.provider + "/" + c.model;
    try {
      const out = await agent(prompt, {
        label: opts.label,
        phase: opts.phase,
        provider: c.provider,
        model: c.model
      });
      if (out !== null && out !== undefined && String(out).trim() !== "") {
        log("✅ [角色:" + opts.label + "] 轮询命中 → " + tag);
        return { ok: true, text: out, used: tag, failures };
      }
      failures.push(tag + "=空返回");
      log("⏭️ [角色:" + opts.label + "] " + tag + " 空返回，顺延下一个");
    } catch (err) {
      const msg = String((err && err.message) || err).slice(0, 80);
      failures.push(tag + "=" + msg);
      log("⏭️ [角色:" + opts.label + "] " + tag + " 不可用（" + msg + "），顺延下一个");
    }
  }
  log("❌ [角色:" + opts.label + "] 候选池全部不可用：" + failures.join(" | "));
  return { ok: false, text: null, used: null, failures };
}
```

> v2.0 统一说明：原 ai-work 用 `[label]`、ai-card 用 `[卡片:label]` 两种日志前缀，
> 现统一为 `[角色:label]`——函数只有这一份，两本书不许再各抄一份。

## 七、交付要求：模型体检报告

workflow 结尾**必须**返回「模型体检报告」：每个角色/卡片汇报 `used`（实际命中模型）与 `failures`（被跳过的失效模型及原因），
让用户随时知道哪几个模型是活的。具体键名由各技能书按自身角色定（ai-work 用 探子A/探子B/策划官/…，ai-card 用 卡1/卡2/…）。

## 八、锁：check-roster.mjs

```text
node _shared\check-roster.mjs
```

四道检查：①契约完整性与格式 ②手抄本回潮检测（模型名单只许在本文件） ③契约断链检测（技能书必须指向本文件） ④体检新鲜度与候选位覆盖率。
退出码 0 = 通过；1 = 存在 FAIL。**改完契约必须跑，跑不过不许用。**

## 九、变更记录

| 日期 | 版本 | 变更 | 锁结果 |
|---|---|---|---|
| 2026-10-27 | v2.3 | 新增「落盘铁律」：所有写文件只能由主 agent 执行，子代理只返回结果（workflow 沙箱无文件权限） | 见 check-roster 输出 |
| 2026-10-27 | v2.2 | 原盘删去可疑位 `work/deepseek-flash`（体检无此模型，运行时必失败，是当年事故的形状） | 见 check-roster 输出 |
| 2026-10-27 | v2.1 | 新增「五、执行流程（三段）」：把 体检→组盘→轮询降级 写成每次拉起的固定步骤；原五~八章顺延为六~九 | PASS（见 check-roster 输出） |
| 2026-10-27 | v2.0 | 建档：由 ai-work / ai-card 两本技能书的手抄本合并为单一契约；runWithFallback 日志前缀统一为 `[角色:label]` | 首跑 PASS（见 check-roster 输出） |
