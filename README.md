# dsh-agent-skills

DSH 原生 AI 团队技能包：**AI Work（四阶段串行流水线）** + **AI Card（并行独立卡片）**，共用同一条「候选池 + 轮询降级」机制。

两本技能书共用一份契约（`_shared/model-pool.md`），遵循 YD-bus 四层一锁架构。

## 结构

```text
~\.agents\skills\                 (C:\Users\Users\.agents\skills\)
├── ai-work\
│   └── SKILL.md                  四阶段串行流水线（侦察→策划→挑刺→裁判）
├── ai-card\
│   └── SKILL.md                  并行独立卡片团队（主 agent 汇总）
└── _shared\
    ├── model-pool.md             契约层：候选池原盘 + provider 修正表 + 三硬规则 + runWithFallback 唯一源码
    ├── health-check.mjs          执行层：体检脚本模板（probe 全部候选模型）
    ├── check-roster.mjs          锁：契约校验（存在性 / 手抄本回潮 / 断链 / 覆盖）
    └── health-*.json             状态层：体检结果（可重建，不入库）
```

## 四层一锁

| 层 | 目录/文件 | 职责 |
|---|---|---|
| 契约层 | `_shared/model-pool.md` | 候选池、规则、源码的唯一权威版本 |
| 技能层 | `ai-work/SKILL.md`、`ai-card/SKILL.md` | 各自编排骨架 |
| 执行层 | `_shared/health-check.mjs` | 体检探活 |
| 状态层 | `_shared/health-*.json` | 体检结果，可重建 |
| 锁 | `_shared/check-roster.mjs` | 改契约后必须跑，通过才算改完 |

## 执行流程（每次拉起照走）

```text
① 体检   → 读 health-<profile>.json；缺失或 >6h → 跑 _shared/health-check.mjs
② 组盘   → 三硬规则：原盘只做减法 + 盘尾兜底 + 不连坐
③ 轮询降级 → runWithFallback()：空/错 → 顺延；全灭 → 报清单，不静默
```

## 三条铁律

1. **禁止硬编码单一模型**：必须走「候选池 + 轮询降级」，全部候选失败必须报清单。
2. **落盘铁律**：所有写文件动作只能由主 agent 执行；子代理只返回结果，无文件权限。
3. **契约唯一源**：改模型/规则只改 `_shared/model-pool.md`，两本技能书不得再抄；改完跑 `check-roster.mjs`。

## 使用

| 命令 | 用途 |
|---|---|
| `/ai-work` | 拉团队 红蓝挑刺 深验证（重大决策/方案审查/可行性判定） |
| `/ai-card` | 派多张独立卡 并行扫描（多角度查证/分头调研/批量比对） |

## 校验

```text
node _shared\check-roster.mjs
```

退出码：0=通过；1=FAIL；2=体检过期需刷新。