/**
 * 上下文与额度 Sidecar 后端 v2.2
 * 1. 通过 RetrieveUserQuotaSummary 获取真实的 5 小时滚动额度与周额度，并自动匹配当前窗口所用模型组；
 * 2. 按模型自动识别上下文上限（Gemini 4: 512K / Flash: 256K / Claude: 200K / GPT-OSS: 128K），提取精确上下文占用、近期增长曲线、缓存命中率与生成速度；
 * 3. 聚合本机历史 Token 消耗（Total / Today / Month / Year）、按日热力图及 Top 5 模型排行。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SidecarApp, Response } from 'sidecar_sdk';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LS_ADDRESS = process.env.ANTIGRAVITY_LS_ADDRESS || '127.0.0.1:5387';
const CSRF_TOKEN = process.env.ANTIGRAVITY_CSRF_TOKEN || '';

const DEFAULT_CONTEXT_LIMIT = 512000;
const USD_TO_CNY = 7.25;
const REF_PRICE = { input: 1.25, cacheRead: 0.125, output: 10.0 };

let historyCache = { ts: 0, key: '', data: null };
const HISTORY_CACHE_TTL_MS = 30_000;

async function callLs(method, body = {}) {
  const res = await fetch(
    `http://${LS_ADDRESS}/exa.language_server_pb.LanguageServerService/${method}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-codeium-csrf-token': CSRF_TOKEN,
      },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) throw new Error(`LS ${method} HTTP ${res.status}`);
  return res.json();
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function formatLocalYmd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function estimateCostUsd(input, cacheRead, output) {
  return (
    (input * REF_PRICE.input +
      cacheRead * REF_PRICE.cacheRead +
      output * REF_PRICE.output) /
    1_000_000
  );
}

/**
 * 根据模型标识与名称自动推断对应的默认上下文窗口上限
 */
function resolveModelContextLimit(canonicalId = '', modelLabel = '') {
  const text = `${canonicalId} ${modelLabel}`.toLowerCase();
  if (/claude/.test(text)) return 200000;
  if (/gpt-oss|\bgpt\b/.test(text)) return 128000;
  if (/3\.8.*flash|\bflash\b/.test(text)) return 256000;
  if (/gemini-4|gemini 4|orchestrator/.test(text)) return 512000;
  return DEFAULT_CONTEXT_LIMIT;
}

/**
 * 构建最近会话列表（最多 10 条），供侧边栏切换查看
 */
function buildConversationsList(summaries = {}, defaultId = '') {
  return Object.entries(summaries)
    .map(([id, s]) => ({
      id,
      title: String(s?.summary || id.slice(0, 8)).trim() || id.slice(0, 8),
      lastModifiedTime: s?.lastModifiedTime || '',
      ts: Date.parse(s?.lastModifiedTime || '') || 0,
      isDefault: id === defaultId,
    }))
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 10)
    .map(({ ts, ...rest }) => rest);
}

/**
 * 解析 RetrieveUserQuotaSummary 分组并匹配当前会话正在使用的模型所属组
 */
function buildQuotaSummary(summaryRes, activeModelLabel = '', activeModelId = '') {
  const rawGroups = summaryRes?.response?.groups || [];
  const baseLabel = String(activeModelLabel || '')
    .replace(/\s*\([^)]*\)\s*$/g, '')
    .trim()
    .toLowerCase();

  let matchedIdx = -1;
  if (baseLabel) {
    matchedIdx = rawGroups.findIndex((g) =>
      String(g?.description || '').toLowerCase().includes(baseLabel)
    );
  }
  if (matchedIdx < 0) {
    const hint = `${activeModelLabel} ${activeModelId}`;
    if (/gemini|orchestrator/i.test(hint)) {
      matchedIdx = rawGroups.findIndex((g) => /gemini/i.test(g?.displayName || ''));
    } else if (/claude|gpt/i.test(hint)) {
      matchedIdx = rawGroups.findIndex((g) => /claude|gpt/i.test(g?.displayName || ''));
    }
  }
  if (matchedIdx < 0 && rawGroups.length > 0) matchedIdx = 0;

  const groups = rawGroups.map((g, idx) => {
    const rawBuckets = Array.isArray(g?.buckets) ? g.buckets : [];
    const buckets = rawBuckets.map((b) => {
      const win = b?.window === 'weekly' ? 'weekly' : '5h';
      const frac = typeof b?.remainingFraction === 'number'
        ? Math.max(0, Math.min(1, b.remainingFraction))
        : 0;
      const percent = Math.round(frac * 1000) / 10;
      return {
        bucketId: b?.bucketId || '',
        window: win,
        windowLabel: win === 'weekly' ? '周额度' : '5小时额度',
        shortTag: win === 'weekly' ? '周' : '5h',
        displayName: b?.displayName || (win === 'weekly' ? 'Weekly Limit Remaining' : 'Five Hour Limit Remaining'),
        description: b?.description || '',
        percent,
        remainingFraction: frac,
        resetTime: b?.resetTime || '',
        disabled: Boolean(b?.disabled),
      };
    });

    buckets.sort((a, b) => (a.window === b.window ? 0 : a.window === '5h' ? -1 : 1));

    const enabledBuckets = buckets.filter((b) => !b.disabled);
    const candidates = enabledBuckets.length > 0 ? enabledBuckets : buckets;
    let tightest = null;
    for (const c of candidates) {
      if (!tightest || c.remainingFraction < tightest.remainingFraction) {
        tightest = c;
      }
    }

    const displayName = g?.displayName || '模型组';
    const shortName = /gemini/i.test(displayName)
      ? 'Gemini'
      : /claude|gpt/i.test(displayName)
      ? 'Claude/GPT'
      : displayName;

    return {
      displayName,
      shortName,
      description: g?.description || '',
      isActive: idx === matchedIdx,
      buckets,
      tightestBucket: tightest,
    };
  });

  groups.sort((a, b) => Number(b.isActive) - Number(a.isActive));
  const activeGroup = groups.find((g) => g.isActive) || groups[0] || null;

  return {
    activeGroup,
    tightestBucket: activeGroup?.tightestBucket || null,
    groups,
  };
}

function extractContextAndSpeed(traj, modelConfigs = []) {
  const steps = traj?.trajectory?.steps || [];
  let latestMeta = null;
  let latestUsage = null;
  let latestStepIdx = -1;
  let sessionAccumTotal = 0;
  const trendAll = [];

  for (let i = 0; i < steps.length; i++) {
    const meta = steps[i]?.metadata;
    const u = meta?.modelUsage;
    if (u) {
      const turnUsed = toNum(u.inputTokens) + toNum(u.cacheReadTokens) + toNum(u.outputTokens);
      sessionAccumTotal += turnUsed;
      trendAll.push(turnUsed);
      latestUsage = u;
      latestMeta = meta;
      latestStepIdx = i;
    }
  }

  const trend = trendAll.slice(-20);

  if (!latestUsage) {
    return {
      hasData: false,
      usedTokens: 0,
      budgetTokens: DEFAULT_CONTEXT_LIMIT,
      budgetSource: 'model_default',
      remainingTokens: DEFAULT_CONTEXT_LIMIT,
      percent: 0,
      modelId: '',
      canonicalModelId: '',
      modelLabel: '等待首轮对话',
      uncachedInput: 0,
      cacheRead: 0,
      outputTokens: 0,
      thinkingTokens: 0,
      responseTokens: 0,
      cacheHitRate: 0,
      stepCount: steps.length,
      sessionAccumTotal: 0,
      trend: [],
      speed: { tps: 0, durationSec: 0, outputTokens: 0, grade: '等待' },
    };
  }

  const uncachedInput = toNum(latestUsage.inputTokens);
  const cacheRead = toNum(latestUsage.cacheReadTokens);
  const outputTokens = toNum(latestUsage.outputTokens);
  const thinkingTokens = toNum(latestUsage.thinkingOutputTokens);
  const responseTokens = toNum(latestUsage.responseOutputTokens) || Math.max(0, outputTokens - thinkingTokens);
  const totalInput = uncachedInput + cacheRead;
  const usedTokens = totalInput + outputTokens;
  const cacheHitRate = totalInput > 0 ? Number(((cacheRead / totalInput) * 100).toFixed(1)) : 0;

  const startMs = Date.parse(latestMeta?.createdAt || '');
  const endMs = Date.parse(latestMeta?.completedAt || '');
  const durationSec =
    Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs
      ? Number(((endMs - startMs) / 1000).toFixed(2))
      : 0;
  const tps = durationSec > 0 && outputTokens > 0 ? Number((outputTokens / durationSec).toFixed(1)) : 0;
  const grade = tps >= 80 ? '极速' : tps >= 35 ? '流畅' : tps > 0 ? '正常' : '待统计';

  const modelId = latestUsage.model || '';
  const matched = modelConfigs.find((c) => c?.modelOrAlias?.model === modelId);
  const canonicalModelId = matched?.modelId || modelId || 'unknown';
  const modelLabel = matched?.label || modelId || '未知模型';
  const budgetTokens = resolveModelContextLimit(canonicalModelId, modelLabel);
  const percent = Number(Math.min(100, (usedTokens / budgetTokens) * 100).toFixed(1));

  return {
    hasData: true,
    usedTokens,
    budgetTokens,
    budgetSource: 'model_default',
    remainingTokens: Math.max(0, budgetTokens - usedTokens),
    percent,
    modelId,
    canonicalModelId,
    modelLabel,
    uncachedInput,
    cacheRead,
    outputTokens,
    thinkingTokens,
    responseTokens,
    cacheHitRate,
    stepIndex: latestStepIdx,
    stepCount: steps.length,
    sessionAccumTotal,
    trend,
    speed: { tps, durationSec, outputTokens, grade },
  };
}

/**
 * 聚合本机全部会话的每日 Token 消耗与模型消耗排行（带 30s 缓存）
 */
async function aggregateHistory(summaries, currentId, currentTraj, modelConfigs = [], force = false) {
  const now = Date.now();
  const cacheKey = `${Object.keys(summaries || {}).length}:${currentId}`;
  if (!force && historyCache.data && historyCache.key === cacheKey && now - historyCache.ts < HISTORY_CACHE_TTL_MS) {
    return historyCache.data;
  }

  const labelMap = new Map();
  for (const cfg of modelConfigs) {
    const id = cfg?.modelOrAlias?.model;
    if (id && cfg?.label) labelMap.set(id, cfg.label);
  }

  const dailyMap = {};
  const modelStats = new Map();
  let totalTokens = 0;
  let totalInput = 0;
  let totalCache = 0;
  let totalOutput = 0;
  let totalCostUsd = 0;
  let sessionCount = 0;
  let firstDate = '';

  const ids = Object.keys(summaries || {});
  const seenMsgIds = new Set();

  for (const id of ids) {
    let traj = id === currentId ? currentTraj : null;
    if (!traj) {
      try {
        traj = await callLs('GetCascadeTrajectory', { cascadeId: id });
      } catch {
        continue;
      }
    }
    const steps = traj?.trajectory?.steps || [];
    let hasUsageInSession = false;
    for (const step of steps) {
      const meta = step?.metadata;
      const u = meta?.modelUsage;
      if (!u) continue;
      const msgKey = u.messageId || u.responseId || '';
      if (msgKey) {
        if (seenMsgIds.has(msgKey)) continue;
        seenMsgIds.add(msgKey);
      }
      hasUsageInSession = true;
      const inp = toNum(u.inputTokens);
      const cache = toNum(u.cacheReadTokens);
      const out = toNum(u.outputTokens);
      const sum = inp + cache + out;
      const cost = estimateCostUsd(inp, cache, out);

      const d = new Date(meta?.completedAt || meta?.createdAt || Date.now());
      const ymd = Number.isFinite(d.getTime()) ? formatLocalYmd(d) : formatLocalYmd(new Date());
      if (!firstDate || ymd < firstDate) firstDate = ymd;

      if (!dailyMap[ymd]) {
        dailyMap[ymd] = { total: 0, input: 0, cache: 0, output: 0, costUsd: 0, calls: 0 };
      }
      dailyMap[ymd].total += sum;
      dailyMap[ymd].input += inp;
      dailyMap[ymd].cache += cache;
      dailyMap[ymd].output += out;
      dailyMap[ymd].costUsd += cost;
      dailyMap[ymd].calls += 1;

      const rawModelId = u.model || 'unknown';
      const modelLabel = labelMap.get(rawModelId) || rawModelId;
      if (!modelStats.has(modelLabel)) {
        modelStats.set(modelLabel, { label: modelLabel, tokens: 0, calls: 0, costUsd: 0 });
      }
      const ms = modelStats.get(modelLabel);
      ms.tokens += sum;
      ms.calls += 1;
      ms.costUsd += cost;

      totalTokens += sum;
      totalInput += inp;
      totalCache += cache;
      totalOutput += out;
      totalCostUsd += cost;
    }
    if (hasUsageInSession) sessionCount++;
  }

  const today = new Date();
  const todayKey = formatLocalYmd(today);
  const monthPrefix = todayKey.slice(0, 7);
  const yearPrefix = todayKey.slice(0, 4);

  let todayTokens = 0, todayCost = 0;
  let monthTokens = 0, monthCost = 0, monthActiveDays = 0;
  let yearTokens = 0, yearCost = 0, yearActiveDays = 0;

  for (const [ymd, rec] of Object.entries(dailyMap)) {
    if (ymd === todayKey) {
      todayTokens += rec.total;
      todayCost += rec.costUsd;
    }
    if (ymd.startsWith(monthPrefix)) {
      monthTokens += rec.total;
      monthCost += rec.costUsd;
      if (rec.total > 0) monthActiveDays++;
    }
    if (ymd.startsWith(yearPrefix)) {
      yearTokens += rec.total;
      yearCost += rec.costUsd;
      if (rec.total > 0) yearActiveDays++;
    }
  }

  const modelBreakdown = [...modelStats.values()]
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 5)
    .map((m) => ({
      label: m.label,
      tokens: m.tokens,
      calls: m.calls,
      costUsd: Number(m.costUsd.toFixed(2)),
      sharePercent: totalTokens > 0 ? Number(((m.tokens / totalTokens) * 100).toFixed(1)) : 0,
    }));

  const result = {
    firstDate,
    sessionCount,
    usdToCny: USD_TO_CNY,
    total: { tokens: totalTokens, costUsd: Number(totalCostUsd.toFixed(2)), input: totalInput, cache: totalCache, output: totalOutput },
    today: { tokens: todayTokens, costUsd: Number(todayCost.toFixed(2)) },
    month: { tokens: monthTokens, costUsd: Number(monthCost.toFixed(2)), activeDays: monthActiveDays },
    year: { tokens: yearTokens, costUsd: Number(yearCost.toFixed(2)), activeDays: yearActiveDays },
    modelBreakdown,
    dailyMap,
  };

  historyCache = { ts: now, key: cacheKey, data: result };
  return result;
}

const app = new SidecarApp();

app.page('/', () => readFileSync(join(__dirname, 'index.html'), 'utf-8'));

app.api('/logo.svg', () =>
  new Response(readFileSync(join(__dirname, '..', '..', 'assets', 'logo.svg'), 'utf-8'), {
    contentType: 'image/svg+xml',
    headers: { 'Cache-Control': 'public, max-age=3600' },
  }),
'GET');

app.api('/api/telemetry', async (data) => {
  try {
    const defaultConv = app.config.conversationId || '';
    const requestedConv = typeof data?.conversationId === 'string' ? data.conversationId.trim() : '';
    const forceHistory = data?.force === '1' || data?.force === 'true';

    const [userStatusRes, quotaSummaryRes, allTrajRes] = await Promise.all([
      callLs('GetUserStatus', {}),
      callLs('RetrieveUserQuotaSummary', {}),
      callLs('GetAllCascadeTrajectories', {}),
    ]);

    const userStatus = userStatusRes?.userStatus || {};
    const planInfo = userStatus?.planStatus?.planInfo || {};
    const modelConfigs = userStatus?.cascadeModelConfigData?.clientModelConfigs || [];
    const summaries = allTrajRes?.trajectorySummaries || {};

    let targetId = '';
    if (requestedConv && summaries[requestedConv]) {
      targetId = requestedConv;
    } else if (defaultConv && summaries[defaultConv]) {
      targetId = defaultConv;
    } else {
      let latestMs = -1;
      for (const [id, s] of Object.entries(summaries)) {
        const ms = Date.parse(s?.lastModifiedTime || '') || 0;
        if (ms > latestMs) {
          latestMs = ms;
          targetId = id;
        }
      }
    }

    let currentTraj = null;
    if (targetId) {
      currentTraj = await callLs('GetCascadeTrajectory', { cascadeId: targetId });
    }

    const contextInfo = extractContextAndSpeed(currentTraj, modelConfigs);
    contextInfo.title = summaries[targetId]?.summary || '';
    contextInfo.conversationId = targetId;

    const quota = buildQuotaSummary(quotaSummaryRes, contextInfo.modelLabel, contextInfo.modelId);
    const history = await aggregateHistory(summaries, targetId, currentTraj, modelConfigs, forceHistory);
    const conversations = buildConversationsList(summaries, defaultConv || targetId);

    return {
      ok: true,
      updatedAt: new Date().toISOString(),
      plan: {
        name: planInfo.planName || 'Free',
        monthlyPriceUsd: /ultra/i.test(planInfo.planName || '') ? 249.99 : /pro/i.test(planInfo.planName || '') ? 19.99 : 0,
        promptCredits: userStatus?.planStatus?.availablePromptCredits ?? null,
        flowCredits: userStatus?.planStatus?.availableFlowCredits ?? null,
      },
      conversations,
      context: contextInfo,
      quota,
      history,
    };
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: err?.message || '读取本地服务失败' }),
      { contentType: 'application/json', status: 500 }
    );
  }
}, 'GET');

app.run();
