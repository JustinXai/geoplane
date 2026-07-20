'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';

interface Task {
  id: string;
  platform: string;
  question: string;
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'MANUAL_REQUIRED';
  answerText?: string | null;
  errorMessage?: string | null;
}

interface DetectionRun {
  id: string;
  name: string;
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'MANUAL_REQUIRED';
  createdAt: string;
  tasks: Task[];
}

interface Summary {
  brandMentionRate: number;
  recommendRate: number;
  avgRank: number;
  platformBreakdown: Record<string, { mentionCount: number; totalCount: number; recommendCount: number }>;
}

interface DetectionRunViewProps {
  runId: string;
  clientOrganizationId: string;
  projectId: string;
}

const PLATFORM_LABELS: Record<string, string> = {
  DOUBAO: '豆包',
  QWEN: '通义千问',
  DEEPSEEK: 'DeepSeek',
  YUANBAO: '腾讯元宝',
};

const STATUS_LABELS: Record<string, string> = {
  PENDING: '等待中',
  RUNNING: '执行中',
  SUCCEEDED: '已完成',
  FAILED: '失败',
  MANUAL_REQUIRED: '需要人工',
};

const STATUS_TONE: Record<string, 'info' | 'warning' | 'success' | 'danger' | 'default'> = {
  PENDING: 'default',
  RUNNING: 'info',
  SUCCEEDED: 'success',
  FAILED: 'danger',
  MANUAL_REQUIRED: 'warning',
};

export function DetectionRunView({ runId, clientOrganizationId, projectId }: DetectionRunViewProps) {
  const [run, setRun] = useState<DetectionRun | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [showSummary, setShowSummary] = useState(false);
  const [manualAnswer, setManualAnswer] = useState<Record<string, string>>({});
  const [submittingAnswer, setSubmittingAnswer] = useState<Set<string>>(new Set());
  const [answerMessage, setAnswerMessage] = useState<string | null>(null);

  const fetchRun = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/detection/runs/${runId}`);
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || '无法加载探测任务');
      }
      const data = await response.json();
      setRun(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [runId]);

  const fetchSummary = useCallback(async () => {
    try {
      const response = await fetch(`/api/detection/runs/${runId}/summary`);
      if (response.ok) {
        const data = await response.json();
        setSummary(data);
      }
    } catch {
      // summary is optional
    }
  }, [runId]);

  useEffect(() => {
    void fetchRun();
  }, [fetchRun]);

  async function handleAnalyze() {
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const response = await fetch(`/api/detection/runs/${runId}/analyze`, { method: 'POST' });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || '分析失败');
      }
      setShowSummary(true);
      await fetchSummary();
    } catch (err) {
      setAnalyzeError(err instanceof Error ? err.message : '分析失败');
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleSubmitAnswer(taskId: string, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const answerText = manualAnswer[taskId]?.trim();
    if (!answerText) return;

    setSubmittingAnswer((prev) => new Set(prev).add(taskId));
    setAnswerMessage(null);

    try {
      const response = await fetch(`/api/detection/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answerText }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || '提交失败');
      }

      setAnswerMessage('回答已保存');
      await fetchRun();
    } catch (err) {
      setAnswerMessage(err instanceof Error ? err.message : '提交失败');
    } finally {
      setSubmittingAnswer((prev) => {
        const next = new Set(prev);
        next.delete(taskId);
        return next;
      });
    }
  }

  if (loading) {
    return <p className="cp-placeholder-note">正在加载…</p>;
  }

  if (error) {
    return (
      <div className="cp-feedback cp-feedback-error">
        <strong>加载失败</strong>
        <p>{error}</p>
        <button className="cp-button" onClick={() => void fetchRun()} style={{ marginTop: '8px' }}>
          重试
        </button>
      </div>
    );
  }

  if (!run) return null;

  const tasksByPlatform = run.tasks.reduce<Record<string, Task[]>>((acc, task) => {
    if (!acc[task.platform]) acc[task.platform] = [];
    acc[task.platform]!.push(task);
    return acc;
  }, {});

  return (
    <div className="cp-stack">
      <div className="cp-card">
        <div className="cp-section-heading">
          <div>
            <h2>{run.name}</h2>
            <p>
              创建于 {new Date(run.createdAt).toLocaleString('zh-CN')}
            </p>
          </div>
          <span className={`status-tag ${STATUS_TONE[run.status] !== 'default' ? `status-tag[data-tone="${STATUS_TONE[run.status]}"]` : ''}`}>
            {STATUS_LABELS[run.status] ?? run.status}
          </span>
        </div>
      </div>

      <div className="cp-card">
        <div className="cp-section-heading">
          <div>
            <h2>探测任务</h2>
            <p>
              共 {run.tasks.length} 个任务 · 已完成 {run.tasks.filter((t) => t.status === 'SUCCEEDED').length} 个
            </p>
          </div>
          <button
            className="cp-button cp-button-primary"
            onClick={() => void handleAnalyze()}
            disabled={analyzing || run.tasks.every((t) => t.status !== 'SUCCEEDED')}
          >
            {analyzing ? '分析中…' : '生成分析'}
          </button>
        </div>

        {analyzeError && (
          <div className="cp-feedback cp-feedback-error" style={{ marginBottom: '16px' }}>
            {analyzeError}
          </div>
        )}

        {Object.entries(tasksByPlatform).map(([platform, tasks]) => (
          <div key={platform} style={{ marginBottom: '20px' }}>
            <h3 style={{ margin: '0 0 12px', fontSize: '14px', fontWeight: 700, color: 'var(--color-ink-700)' }}>
              {PLATFORM_LABELS[platform] ?? platform}
            </h3>
            <div className="cp-table-wrap">
              <table className="cp-data-table">
                <thead>
                  <tr>
                    <th>用户问题</th>
                    <th>状态</th>
                    <th>回答</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((task) => (
                    <tr key={task.id}>
                      <td style={{ maxWidth: '280px' }}>{task.question}</td>
                      <td>
                        <span className={`status-tag ${task.status !== 'PENDING' && task.status !== 'RUNNING' ? `status-tag[data-tone="${STATUS_TONE[task.status]}"]` : ''}`}>
                          {STATUS_LABELS[task.status] ?? task.status}
                        </span>
                      </td>
                      <td style={{ maxWidth: '300px' }}>
                        {task.status === 'SUCCEEDED' && task.answerText ? (
                          <span style={{ fontSize: '13px', color: 'var(--color-ink-700)' }}>{task.answerText}</span>
                        ) : task.status === 'FAILED' ? (
                          <span style={{ fontSize: '12px', color: 'var(--color-danger)' }}>{task.errorMessage || '检测失败'}</span>
                        ) : task.status === 'MANUAL_REQUIRED' ? (
                          <span style={{ fontSize: '12px', color: 'var(--color-warning)' }}>需要人工填写回答</span>
                        ) : (
                          <span style={{ fontSize: '12px', color: 'var(--color-ink-500)' }}>等待回答</span>
                        )}
                      </td>
                      <td>
                        {task.status === 'MANUAL_REQUIRED' && (
                          <form
                            style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}
                            onSubmit={(e) => void handleSubmitAnswer(task.id, e)}
                          >
                            <input
                              type="text"
                              className="cp-input"
                              style={{ width: '200px', minHeight: '32px' }}
                              placeholder="填写回答内容"
                              value={manualAnswer[task.id] ?? ''}
                              onChange={(e) => setManualAnswer((prev) => ({ ...prev, [task.id]: e.target.value }))}
                              required
                            />
                            <button
                              type="submit"
                              className="cp-button"
                              disabled={submittingAnswer.has(task.id)}
                            >
                              {submittingAnswer.has(task.id) ? '…' : '提交'}
                            </button>
                          </form>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}

        {answerMessage && (
          <div className="cp-feedback cp-feedback-success">{answerMessage}</div>
        )}
      </div>

      {showSummary && summary && (
        <div className="cp-card">
          <div className="cp-section-heading">
            <div>
              <h2>分析摘要</h2>
            </div>
          </div>
          <div className="cp-metric-grid">
            <div>
              <strong>{(summary.brandMentionRate * 100).toFixed(1)}%</strong>
              <span>品牌提及率</span>
            </div>
            <div>
              <strong>{(summary.recommendRate * 100).toFixed(1)}%</strong>
              <span>推荐率</span>
            </div>
            <div>
              <strong>{summary.avgRank.toFixed(1)}</strong>
              <span>平均排名</span>
            </div>
          </div>
          <h3 style={{ margin: '16px 0 12px', fontSize: '14px', fontWeight: 700 }}>平台分布</h3>
          <div className="cp-table-wrap">
            <table className="cp-data-table">
              <thead>
                <tr>
                  <th>平台</th>
                  <th>提及/总数</th>
                  <th>提及率</th>
                  <th>推荐数</th>
                  <th>推荐率</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(summary.platformBreakdown).map(([platform, stats]) => (
                  <tr key={platform}>
                    <td>{PLATFORM_LABELS[platform] ?? platform}</td>
                    <td>{stats.mentionCount} / {stats.totalCount}</td>
                    <td>{stats.totalCount > 0 ? ((stats.mentionCount / stats.totalCount) * 100).toFixed(1) : '0.0'}%</td>
                    <td>{stats.recommendCount}</td>
                    <td>{stats.totalCount > 0 ? ((stats.recommendCount / stats.totalCount) * 100).toFixed(1) : '0.0'}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
