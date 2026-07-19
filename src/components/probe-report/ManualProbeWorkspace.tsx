"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { RawProbeResult, ProbeFailureCode } from "../../runtime/probes/manual-sample.js";
import {
  DOMESTIC_AI_PLATFORMS,
  PROBE_FAILURE_LABELS,
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

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listManualProbeSamples(projectId);
      if (result.ok) {
        setResults(result.data);
        setMessage("");
      } else {
        setMessage(result.code === "FORBIDDEN" ? "你无权查看该项目的人工查询记录。" : result.message);
      }
    } catch {
      setMessage("暂时无法读取人工查询记录，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void refresh(); }, [refresh]);
  const summary = useMemo(() => summarizeProbeResults(results), [results]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
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
        setMessage("人工查询样本已保存。");
        event.currentTarget.reset();
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
          <div><h2 id="manual-probe-title">国内 AI 人工查询</h2><p>由人工选择问题并粘贴平台实际返回内容；系统不会自动登录或调用模型。</p></div>
        </div>
        <form className="cp-form-grid" onSubmit={submit}>
          <label>查询平台<select name="platform" required>{activePlatforms.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select></label>
          <label>用户问题<select name="question" required defaultValue=""><option value="" disabled>请选择已确认的问题</option>{questions.map((question) => <option key={question} value={question}>{question}</option>)}</select></label>
          <label>查询时间<input name="observedAt" type="datetime-local" required /></label>
          <label>查询结果<select value={outcome} onChange={(event) => setOutcome(event.target.value as "ANSWERED" | "FAILED")}><option value="ANSWERED">已获得回答</option><option value="FAILED">查询失败</option></select></label>
          {outcome === "ANSWERED" ? <label className="cp-form-wide">平台回答<textarea name="answerText" rows={8} required placeholder="粘贴平台实际返回的完整回答" /></label> : <>
            <label>失败原因<select name="failureCode" required>{Object.entries(PROBE_FAILURE_LABELS).map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></label>
            <label>补充说明<input name="failureMessage" placeholder="可选" /></label>
          </>}
          <label className="cp-form-wide">截图引用<input name="screenshotReference" placeholder="填写受控存储中的截图引用（可选），不要粘贴登录凭据" /></label>
          <div className="cp-form-actions"><button className="cp-button cp-button-primary" type="submit" disabled={submitting || questions.length === 0}>{submitting ? "正在保存…" : "保存人工样本"}</button></div>
        </form>
        {questions.length === 0 && <p className="cp-callout">当前没有可选择的已确认问题，请先完成关键词与用户问题确认。</p>}
        {message && <p role="status" className="cp-callout">{message}</p>}
      </section>

      <section className="cp-card" aria-labelledby="probe-report-title">
        <div className="cp-section-heading"><div><h2 id="probe-report-title">人工查询记录与报告口径</h2><p>仅展示已经保存的真实样本，不生成推测数据。</p></div></div>
        {loading ? <p className="cp-placeholder-note">正在读取记录…</p> : results.length === 0 ? <p className="cp-placeholder-note">尚无人工查询记录。</p> : <>
          <div className="cp-metric-grid"><div><strong>{summary.sampleCount}</strong><span>样本总数</span></div><div><strong>{summary.answeredCount}</strong><span>获得回答</span></div><div><strong>{summary.failedCount}</strong><span>查询失败</span></div></div>
          <div className="cp-table-wrap"><table className="cp-data-table"><thead><tr><th>平台</th><th>问题</th><th>结果</th><th>查询时间</th></tr></thead><tbody>{[...results].reverse().map((item) => <tr key={item.id}><td>{DOMESTIC_AI_PLATFORMS.find((platform) => platform.code === item.platform)?.name ?? item.platform}</td><td>{item.question}</td><td>{item.outcome === "ANSWERED" ? "已获得回答" : "查询失败"}</td><td>{new Date(item.observedAt).toLocaleString("zh-CN")}</td></tr>)}</tbody></table></div>
        </>}
        <div className="cp-callout"><strong>能力说明：</strong>账号与样本关联、品牌/竞品/推荐人工确认尚未开放。已管理信源引用率尚未计算，系统不会自动推断。</div>
        <p className="cp-placeholder-note">Kimi、文心一言暂未启用。</p>
      </section>
    </div>
  );
}
