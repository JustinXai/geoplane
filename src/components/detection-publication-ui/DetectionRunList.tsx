'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

interface DetectionRun {
  id: string;
  name: string;
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'MANUAL_REQUIRED';
  platforms: string[];
  questionCount: number;
  createdAt: string;
}

interface DetectionRunListProps {
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

export function DetectionRunList({ clientOrganizationId, projectId }: DetectionRunListProps) {
  const [runs, setRuns] = useState<DetectionRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRuns = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/detection/runs?projectId=${encodeURIComponent(projectId)}`);
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || '无法加载探测任务列表');
      }
      const data = await response.json();
      setRuns(Array.isArray(data) ? data : data.runs || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void fetchRuns();
  }, [fetchRuns]);

  if (loading) {
    return <p className="cp-placeholder-note">正在加载探测任务…</p>;
  }

  if (error) {
    return (
      <div className="cp-feedback cp-feedback-error">
        <strong>加载失败</strong>
        <p>{error}</p>
        <button className="cp-button" onClick={() => void fetchRuns()} style={{ marginTop: '8px' }}>
          重试
        </button>
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="state-panel">
        <h2>还没有探测任务</h2>
        <p>点击上方按钮创建探测任务，开始对国内 AI 平台进行品牌探测。</p>
      </div>
    );
  }

  return (
    <div className="cp-table-wrap">
      <table className="cp-data-table">
        <thead>
          <tr>
            <th>任务名称</th>
            <th>状态</th>
            <th>平台</th>
            <th>问题数</th>
            <th>创建时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id}>
              <td style={{ fontWeight: 600 }}>{run.name}</td>
              <td>
                <span className={`status-tag ${run.status !== 'PENDING' && run.status !== 'RUNNING' ? `status-tag[data-tone="${STATUS_TONE[run.status]}"]` : ''}`}>
                  {STATUS_LABELS[run.status] ?? run.status}
                </span>
              </td>
              <td>
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                  {(run.platforms || []).map((platform) => (
                    <span key={platform} style={{ fontSize: '12px', padding: '2px 6px', background: '#f0f4ff', borderRadius: '4px', color: 'var(--color-brand-700)' }}>
                      {PLATFORM_LABELS[platform] ?? platform}
                    </span>
                  ))}
                </div>
              </td>
              <td>{run.questionCount ?? '—'}</td>
              <td style={{ color: 'var(--color-ink-500)', fontSize: '13px' }}>
                {new Date(run.createdAt).toLocaleString('zh-CN')}
              </td>
              <td>
                <Link
                  href={`?runId=${run.id}`}
                  className="cp-button"
                  style={{ fontSize: '12px', padding: '4px 10px', minHeight: '28px' }}
                >
                  查看
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
