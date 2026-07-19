"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { RawProbeResult, ProbeFailureCode } from "../../runtime/probes/manual-sample.js";
import {
  DOMESTIC_AI_PLATFORMS,
  PROBE_FAILURE_LABELS,
  filterProbeResults,
  listManualProbeSamples,
  recordManualProbeSample,
  summarizeProbeResults,
} from "./probe-client.js";

export interface ManualProbeWorkspaceProps {
  readonly projectId: string;
  readonly questions: readonly string[];
}

const activePlatforms = DOMESTIC_AI_PLATFORMS.filter((item) => item.enabled);

export function ManualProbeWorkspace({ projectId, questions }: ManualProbeWorkspaceProps) {
  const [results, setResults] = useState<readonly RawProbeResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState<"ANSWERED" | "FAILED">("ANSWERED");
  const [platformFilter, setPlatformFilter] = useState("");
  const [outcomeFilter, setOutcomeFilter] = useState<"ALL" | "ANSWERED" | "FAILED">("ALL");
  const [questionFilter, setQuestionFilter] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listManualProbeSamples(projectId);
      if (result.ok) {
        setResults(result.data);
        setMessage("");
      } else {
        setMessage(result.code === "FORBIDDEN" ? "你无权查看该项目的国内 AI 检测记录。" : result.message);
      }
    } catch {
      setMessage("暂时无法读取国内 AI 检测记录，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void refresh(); }, [refresh]);
  const summary = useMemo(() => summarizeProbeResults(results), [results]);
  const visibleResults = useMemo(() => filterProbeResults(results, {
    platform: platformFilter, outcome: outcomeFilter, question: questionFilter,
  }), [results, platformFilter, outcomeFilter, questionFilter]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setSubmitting(true);
    setMessage("");
    const failureCode = String(form.get("failureCode") ?? "") as ProbeFailureCode;
    try {
      const result = await recordManualProbeSample({
        projectId,
        platform: String(form.get("platform") ?? ""),
        collectionMode: "MANUAL_SAMPLE",
        question: String(form.get("question") ?? ""),
        outcome,
        answerText: outcome === "ANSWERED" ? String(form.get("answerText") ?? "") : null,
        screenshotReference: String(form.get("screenshotReference") ?? ""),
        failureCode: outcome === "FAILED" ? failureCode : null,
        failureMessage: outcome === "FAILED" ? String(form.get("failureMessage") ?? "") : null,
        observedAt: new Date(String(form.get("observedAt") ?? "")).toISOString(),
      });
      if (!result.ok) setMessage(result.message);
      else {
        setMessage("国内 AI 检测样本已保存。");
        formElement.reset();
        setOutcome("ANSWERED");
        await refresh();
      }
    } catch {
      setMessage("保存失败，请检查时间和必填信息后重试。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="cp-stack">
      <section className="cp-card" aria-labelledby="manual-probe-title">
        <div className="cp-section-heading">
          <div><h2 id="manual-probe-title">国内 AI 检测登记</h2><p>人工选择已确认问题并登记平台实际结果；系统不会自动登录，也不会调用真实平台。</p></div>
        </div>
        <form className="cp-form-grid" onSubmit={submit}>
          <label>检测平台<select name="platform" required>{activePlatforms.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select></label>
          <label>用户问题<select name="question" required defaultValue=""><option value="" disabled>请选择已确认的问题</option>{questions.map((question) => <option key={question} value={question}>{question}</option>)}</select></label>
          <label>检测时间<input name="observedAt" type="datetime-local" required /></label>
          <label>检测结果<select value={outcome} onChange={(event) => setOutcome(event.target.value as "ANSWERED" | "FAILED")}><option value="ANSWERED">已获得回答</option><option value="FAILED">检测失败</option></select></label>
          {outcome === "ANSWERED" ? <label className="cp-form-wide">回答摘要<textarea name="answerText" rows={6} required placeholder="如实填写本次回答的关键内容，不要填写账号或凭据" /></label> : <>
            <label>失败原因<select name="failureCode" required>{Object.entries(PROBE_FAILURE_LABELS).map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></label>
            <label>补充说明<input name="failureMessage" placeholder="可选" /></label>
          </>}
          <label className="cp-form-wide">证据引用<input name="screenshotReference" placeholder="可填写受控存储中的截图编号或引用；不要填写链接凭据" /></label>
          <div className="cp-form-actions"><button className="cp-button cp-button-primary" type="submit" disabled={submitting || questions.length === 0}>{submitting ? "正在保存…" : "保存检测样本"}</button></div>
        </form>
        {questions.length === 0 && <p className="cp-callout">当前没有可选择的已确认问题，请先完成关键词与用户问题确认。</p>}
        {message && <p role="status" className="cp-callout">{message}</p>}
      </section>

      <section className="cp-card" aria-labelledby="probe-report-title">
        <div className="cp-section-heading"><div><h2 id="probe-report-title">检测记录</h2><p>只汇总已保存的人工真实样本，不生成或推测结果。</p></div></div>
        {loading ? <p className="cp-placeholder-note">正在读取记录…</p> : results.length === 0 ? <p className="cp-placeholder-note">尚无检测记录。完成一次人工检测后，记录会保存在这里。</p> : <>
          <div className="cp-metric-grid"><div><strong>{summary.sampleCount}</strong><span>样本总数</span></div><div><strong>{summary.answeredCount}</strong><span>获得回答</span></div><div><strong>{summary.failedCount}</strong><span>检测失败</span></div></div>
          <div className="cp-form-grid" aria-label="检测记录筛选">
            <label>平台<select value={platformFilter} onChange={(event)=>setPlatformFilter(event.target.value)}><option value="">全部平台</option>{activePlatforms.map(item=><option key={item.code} value={item.code}>{item.name}</option>)}</select></label>
            <label>状态<select value={outcomeFilter} onChange={(event)=>setOutcomeFilter(event.target.value as typeof outcomeFilter)}><option value="ALL">全部状态</option><option value="ANSWERED">已获得回答</option><option value="FAILED">检测失败</option></select></label>
            <label>问题关键词<input value={questionFilter} onChange={(event)=>setQuestionFilter(event.target.value)} placeholder="筛选用户问题" /></label>
          </div>
          {visibleResults.length===0?<p className="cp-placeholder-note">没有符合当前筛选条件的检测记录。</p>:<div className="cp-table-wrap"><table className="cp-data-table"><thead><tr><th>平台</th><th>问题</th><th>状态</th><th>检测时间</th><th>详情</th></tr></thead><tbody>{[...visibleResults].reverse().map((item) => <tr key={item.id}><td>{DOMESTIC_AI_PLATFORMS.find((platform) => platform.code === item.platform)?.name ?? "已停用平台"}</td><td>{item.question}</td><td>{item.outcome === "ANSWERED" ? "已获得回答" : "检测失败"}</td><td>{new Date(item.observedAt).toLocaleString("zh-CN")}</td><td><details><summary>查看</summary><p><strong>{item.outcome==="ANSWERED"?"回答摘要":"失败说明"}：</strong>{item.answerText??item.failureMessage??PROBE_FAILURE_LABELS[item.failureCode as ProbeFailureCode]??"未填写"}</p><p><strong>证据引用：</strong>{item.screenshotReference??"未填写"}</p><p><strong>登记时间：</strong>{new Date(item.recordedAt).toLocaleString("zh-CN")}</p></details></td></tr>)}</tbody></table></div>}
        </>}
        <div className="cp-callout"><strong>当前可交付范围：</strong>仅支持豆包、通义千问、DeepSeek、腾讯元宝的人工检测原始记录；自动登录关闭，真实平台调用为 0。品牌提及、推荐情况、回答位置和引用判断尚不能持久保存，因此客户效果报告暂不生成，系统不会根据回答摘要推测指标。</div>
      </section>
    </div>
  );
}
