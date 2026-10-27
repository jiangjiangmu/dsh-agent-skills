// ============================================================================
//  health-check.mjs — 共享探活脚本（ai-card / ai-work 两本书共用）
//  位置：_shared\health-check.mjs
//  作用：把当前 profile 注册的全部模型逐个走 `agent()` 真实路径探活，
//        产出 health-<profile>.json，供两本技能书组装候选池。
// ============================================================================
//
//  【怎么用】—— 这是给 agent 读的模板，不是给 node 跑的模块。
//  workflow 工具的脚本沙箱没有文件系统/网络权限，所以：
//    1. agent 先 read 本文件，取出下面 `SCRIPT` 里的 JS 代码
//    2. 把 `CANDIDATES` 换成当前 profile 的真实 provider/model 清单
//    3. 整段作为 workflow 工具的 script 参数执行
//    4. agent 拿到返回的 results 数组后，自己写入 health-<profile>.json
//
//  【判定口径】与 runWithFallback() 一字不差：
//    返回非 null/undefined 且 String(out).trim() !== ""  → 活 (ok:true)
//    抛错 / 返回 null / 空串                                → 死 (ok:false)
//
//  【分块】每个 chunk 20 个，只判前 2 个样本，避免打爆并发与配额。
//
// ---------------------------------------------------------------------------
//  SCRIPT（把下面直到 `// == END SCRIPT ==` 之间的内容整体交给 workflow）
// ---------------------------------------------------------------------------

phase("体检全量探活");

// ① 替换成本 profile 的真实清单：[[provider, model], ...]
//    来源 = profiles/<profile>/cordis.patch.yml 的 providers 段
const CANDIDATES = [
  ["gemini", "gemini-3.8-flash-high"],
  ["agent2api", "agnes-3.0-flash"]
];

const CHUNK = 20;
const results = [];

for (let i = 0; i < CANDIDATES.length; i += CHUNK) {
  const slice = CANDIDATES.slice(i, i + CHUNK);
  const got = await parallel(slice.map(([p, m]) => async () => {
    const tag = p + "/" + m;
    try {
      // 只发一个最小请求，两个样本任一非空即算活
      const out = await agent("回复 OK 两个字，不要标点。", {
        label: "体检 " + tag, phase: "体检全量探活",
        provider: p, model: m
      });
      const t = out === null || out === undefined ? "" : String(out).trim();
      if (t !== "") return { provider: p, model: m, ok: true, detail: t.slice(0, 40) };
      return { provider: p, model: m, ok: false, detail: "空返回" };
    } catch (e) {
      return { provider: p, model: m, ok: false,
               detail: "ERR: " + String((e && e.message) || e).slice(0, 120) };
    }
  }));
  for (const r of got) if (r) results.push(r);
  log("chunk " + (Math.floor(i / CHUNK) + 1) + " 完成，累计活 "
      + results.filter(x => x.ok).length + "/" + results.length);
}

return {
  generatedAt: new Date().toISOString(),
  results: results,
  alive: results.filter(x => x.ok).length,
  dead: results.filter(x => !x.ok).length
};

// == END SCRIPT ==
//
// ---------------------------------------------------------------------------
//  【落盘格式】agent 拿到结果后写成 health-<profile>.json：
//
//  {
//    "generatedAt": "2026-10-14T14:48:00+08:00",
//    "profile": "desktop",              // desktop | web，取自 DSH_PROFILE
//    "results": [
//      { "provider": "agent2api", "model": "agnes-3.0-flash",
//        "ok": true,  "detail": "OK" },
//      { "provider": "gemini", "model": "gemini-3.8-flash-high",
//        "ok": false, "detail": "空返回" }
//    ]
//  }
//
//  【组盘规则】（两本技能书共同遵守，用户 m00719 / m00723 定死）
//    1. 原盘原序，只做减法：技能书里写死的候选，按原顺序保留；
//       体检里 ok:false 的划掉，不补位、不重排。
//    2. 盘尾兜底：体检里 ok:true 但原本不在任何一个盘里的模型，
//       按 profile 配置里的原始出现顺序，追加到每个盘的盘尾。
//       只有原盘的人全死光才轮到，绝不插队、绝不顶替。
//    3. 同一个模型在多个盘里各判各的，不连坐。
//    4. 两本书共用同一套四个盘；兜底只追加一次。
// ---------------------------------------------------------------------------
