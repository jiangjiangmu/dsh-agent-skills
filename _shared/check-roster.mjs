#!/usr/bin/env node
/**
 * check-roster.mjs — YD-bus「锁」：模型候选池契约校验
 *
 * 校验对象：
 *   _shared/model-pool.md      （契约层，唯一事实源）
 *   ai-work/SKILL.md           （技能层）
 *   ai-card/SKILL.md           （技能层）
 *   _shared/health-*.json      （状态层，体检证据）
 *
 * 四道检查：
 *   ① 契约完整性与格式（pool 块可解析、runWithFallback 在、必要章节在）
 *   ② 手抄本回潮检测（模型名单只允许出现在 model-pool.md）
 *   ③ 契约断链检测（两本技能书必须指向 model-pool.md）
 *   ④ 体检新鲜度与候选位覆盖率
 *
 * 用法：node check-roster.mjs
 * 退出码：0 = 通过（可有 WARN）；1 = 存在 FAIL
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));   // ...\skills\_shared
const ROOT = path.resolve(HERE, '..');                        // ...\skills
const POOL_MD = path.join(HERE, 'model-pool.md');
const BOOKS = ['ai-work', 'ai-card'];
// 手抄本回潮检测标记：这些模型名只允许出现在 model-pool.md
const MARKERS = [
  'agnes-3.0-flash', 'gemini-3.8-flash-high', 'gemini-3.6-flash-high',
  'gemini-3.7-flash-high', 'claude-opus-4-6-thinking', 'claude-sonnet-4-6',
  'step-5-preview', 'deepseek-flash'
];

const FAIL = [], WARN = [], INFO = [];

/* ---------- 1. 契约文件：完整性与格式 ---------- */
let roster = {};
if (!fs.existsSync(POOL_MD)) {
  FAIL.push('契约缺失：_shared/model-pool.md 不存在');
} else {
  const md = fs.readFileSync(POOL_MD, 'utf8');
  const m = md.match(/```pool\s*\n([\s\S]*?)```/);
  if (!m) {
    FAIL.push('契约损坏：model-pool.md 中找不到 ```pool 机读块');
  } else {
    for (const line of m[1].split(/\r?\n/)) {
      const lm = line.match(/^\s*([a-zA-Z][a-zA-Z0-9_]*)\s*:\s*(.+?)\s*$/);
      if (!lm) continue;
      const list = lm[2].split(',').map(s => s.trim()).filter(Boolean);
      roster[lm[1]] = list;
      for (const e of list) {
        if (!/^[a-z0-9_-]+\/[a-z0-9._-]+$/i.test(e)) {
          FAIL.push(`契约格式错：${lm[1]} 盘的「${e}」不是 provider/model 形式`);
        }
      }
    }
    const roles = Object.keys(roster);
    if (!roles.length) {
      FAIL.push('契约损坏：pool 块为空');
    } else {
      const n = Object.values(roster).reduce((a, b) => a + b.length, 0);
      INFO.push(`契约解析 OK：${roles.length} 个盘（${roles.join('/')}），共 ${n} 个候选位`);
    }
    if (!md.includes('runWithFallback')) FAIL.push('契约缺函数：model-pool.md 里没有 runWithFallback 源码');
    if (!/provider\s*修正表/.test(md)) WARN.push('契约缺节：未见「provider 修正表」');
    if (!/三硬规则|三条硬规则/.test(md)) WARN.push('契约缺节：未见「组盘三硬规则」');
  }
}

/* ---------- 2. 技能书：手抄本回潮 + 契约断链 ---------- */
for (const b of BOOKS) {
  const p = path.join(ROOT, b, 'SKILL.md');
  if (!fs.existsSync(p)) { FAIL.push(`技能书缺失：${b}/SKILL.md`); continue; }
  const t = fs.readFileSync(p, 'utf8');
  const leaked = MARKERS.filter(k => t.includes(k));
  if (leaked.length) {
    FAIL.push(`手抄本回潮：${b}/SKILL.md 出现模型名（${leaked.join(', ')}）——模型名单只允许存在 model-pool.md`);
  }
  if (!t.includes('model-pool.md')) {
    FAIL.push(`契约断链：${b}/SKILL.md 未指向 _shared/model-pool.md`);
  }
  if (!new RegExp(`^name:\\s*${b}\\s*$`, 'm').test(t)) {
    WARN.push(`命名异常：${b}/SKILL.md frontmatter name 与目录名不一致`);
  } else {
    INFO.push(`技能书 OK：${b}/SKILL.md（frontmatter 正常、已挂契约指针、无手抄名单）`);
  }
}

/* ---------- 3. 体检证据（状态层）：新鲜度 + 覆盖率 ---------- */
// 锁是纯报告者：体检过期/缺失 → 退出码 2（REFRESH_REQUIRED），提醒先刷新再组盘。
// 锁不能自己刷新（无 agent() 能力）；刷新由 agent 用 workflow 执行 health-check.mjs 后回写 health-*.json。
const ACTIVE = process.env.DSH_PROFILE || 'desktop';
let activeNeedsRefresh = false;
const seen = new Set();
for (const prof of ['desktop', 'web']) {
  const hp = path.join(HERE, `health-${prof}.json`);
  const isActive = (prof === ACTIVE);
  if (!fs.existsSync(hp)) {
    const msg = `体检缺失：health-${prof}.json 不存在（跑一次 health-check.mjs 即生成）`;
    if (isActive) { activeNeedsRefresh = true; WARN.push(msg + ' [需刷新]'); } else WARN.push(msg);
    continue;
  }
  try {
    const raw = fs.readFileSync(hp, 'utf8');
    const j = JSON.parse(raw);
    if (j && j.generatedAt) {
      const gen = Date.parse(j.generatedAt);
      if (Number.isFinite(gen)) {
        const ageH = (Date.now() - gen) / 3600000;
        if (ageH > 6) {
          const msg = `体检过期：health-${prof}.json 距今 ${ageH.toFixed(1)} 小时（>6h）`;
          if (isActive) { activeNeedsRefresh = true; WARN.push(msg + ' [需刷新]'); } else WARN.push(msg);
        } else INFO.push(`体检新鲜：health-${prof}.json（${ageH.toFixed(1)}h 前）`);
      } else {
        WARN.push(`体检字段异常：health-${prof}.json 的 generatedAt 无法解析`);
      }
    } else {
      WARN.push(`体检字段异常：health-${prof}.json 无 generatedAt`);
    }
    // 收集体检里出现过的 provider/model 证据（兼容未知 schema：遍历 + 正则双保险）
    (function walk(o) {
      if (!o || typeof o !== 'object') return;
      for (const [k, v] of Object.entries(o)) {
        if (v && typeof v === 'object') walk(v);
        else if (/provider|model|tag/i.test(k) && v != null && v !== '') seen.add(String(v));
      }
    })(j);
    String(raw).replace(/([a-z0-9_-]+\/[a-z0-9._-]+)/gi, (s, tag) => (seen.add(tag), tag));
  } catch (e) {
    WARN.push(`体检损坏：health-${prof}.json 解析失败（${e.message}）`);
  }
}
// 刷新标记不再用文件：新鲜度以 health-*.json 时间戳为准，每次跑锁重新判定。
if (activeNeedsRefresh) {
  WARN.push(`活跃 profile（${ACTIVE}）体检过期/缺失 → 必须先刷新（agent 用 workflow 跑 health-check.mjs 并回写）`);
}
const all = Object.values(roster).flat();
if (all.length && seen.size) {
  const uncovered = all.filter(tag => {
    const i = tag.indexOf('/');
    const prov = tag.slice(0, i), model = tag.slice(i + 1);
    return !seen.has(tag) && !seen.has(prov) && !seen.has(model);
  });
  if (uncovered.length) {
    WARN.push(`体检未覆盖 ${uncovered.length} 个候选位：${uncovered.join('、')}（警惕：可能是不存在的名字——当年事故的形状，开跑前核实）`);
  } else {
    INFO.push('体检覆盖：全部候选位都在体检证据里出现过');
  }
}

/* ---------- 报告 ---------- */
console.log('=== 候选池契约校验 check-roster ===');
for (const s of INFO) console.log('  INFO  ' + s);
for (const s of WARN) console.log('  WARN  ' + s);
for (const s of FAIL) console.log('  FAIL  ' + s);
if (activeNeedsRefresh) {
  console.log(`🔁 REFRESH_REQUIRED：活跃 profile（${ACTIVE}）体检过期/缺失 → 先按 health-check.mjs 刷新，再组盘`);
} else if (FAIL.length) {
  console.log(`=== 结果：FAIL（${FAIL.length} 项）===`);
} else {
  console.log(`=== 结果：PASS（INFO ${INFO.length} / WARN ${WARN.length} / FAIL ${FAIL.length}）===`);
}
process.exit(FAIL.length ? 1 : (activeNeedsRefresh ? 2 : 0));
