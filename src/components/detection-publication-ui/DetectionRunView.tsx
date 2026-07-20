'use client';

import { useCallback, useEffect, useState } from 'react';

interface Task {
  id: string;
  platform: string;
  question: string;
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  answerText?: string | null;
  brandMentioned?: boolean | null;
  matchedTerms?: string[] | null;
  completedAt?: string | null;
}

interface DetectionRun {
  id: string;
  name: string;
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  createdAt: string;
  tasks: Task[];
}

interface DetectionRunViewProps {
  runId: string;
  projectId: string;
}

const PLATFORM_LABELS: Record<string, string> = {
  DOUBAO: '豆包',
  DEEPSEEK: 'DeepSeek',
};

const STATUS_LABELS: Record<string, string> = {
  PENDING: '等待中',
  RUNNING: '执行中',
  SUCCEEDED: '已完成',
  FAILED: '失败',
};

export function DetectionRunView({ runId, projectId }: DetectionRunViewProps) {
  const [run, setRun] = useState<DetectionRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRun = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/detection/runs/${runId}`);
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || '无法加载探测记录');
      }
      const data = await response.json();
      setRun(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    void fetchRun();
  }, [fetchRun]);

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

  return (
    <div className="cp-card">
      <div className="cp-section-heading">
        <div>
          <h2>{run.name}</h2>
          <p>创建于 {new Date(run.createdAt).toLocaleString('zh-CN')}</p>
        </div>
        <span className={`status-tag ${run.status === 'SUCCEEDED' ? '' : run.status === 'FAILED' ? 'status-tag[data-tone="danger"]' : 'status-tag[data-tone="info"]'}`}>
          {STATUS_LABELS[run.status] || run.status}
        </span>
      </div>

      <div className="cp-table-wrap">
        <table className="cp-data-table">
          <thead>
            <tr>
              <th>问题</th>
              <th>平台</th>
              <th>品牌提及</th>
              <th>匹配词</th>
              <th>原始回答</th>
              <th>完成时间</th>
            </tr>
          </thead>
          <tbody>
            {run.tasks.map((task) => (
              <tr key={task.id}>
                <td style={{ maxWidth: '200px' }}>{task.question}</td>
                <td>{PLATFORM_LABELS[task.platform] || task.platform}</td>
                <td>{task.brandMentioned ? '✅' : task.brandMentioned === false ? '❌' : '—'}</td>
                <td>{task.matchedTerms?.join('、') || '—'}</td>
                <td style={{ maxWidth: '250px' }}>
                  {task.answerText ? (
                    <details>
                      <summary style={{ cursor: 'pointer', fontSize: '12px' }}>点击查看</summary>
                      <div style={{ marginTop: '8px', padding: '8px', background: '#f8f9fb', borderRadius: '4px', fontSize: '12px', whiteSpace: 'pre-wrap' }}>
                        {task.answerText}
                      </div>
                    </details>
                  ) : (
                    <span style={{ color: 'var(--color-ink-500)' }}>—</span>
                  )}
                </td>
                <td style={{ fontSize: '12px', color: 'var(--color-ink-500)' }}>
                  {task.completedAt ? new Date(task.completedAt).toLocaleString('zh-CN') : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
