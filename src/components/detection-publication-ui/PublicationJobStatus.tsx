'use client';

import { useCallback, useEffect, useState } from 'react';

interface PlatformResult {
  platform: string;
  status: string;
  draftUrl?: string | null;
  errorMessage?: string | null;
}

interface PublicationJob {
  id: string;
  status: 'PENDING' | 'WAITING_FOR_BROWSER' | 'RUNNING' | 'DRAFT_CREATED' | 'FAILED';
  createdAt: string;
  platformResults: PlatformResult[];
}

interface PublicationJobStatusProps {
  jobId: string;
}

const PLATFORM_LABELS: Record<string, string> = {
  WECHAT_OFFICIAL_ACCOUNT: '微信公众号',
  ZHIHU: '知乎',
  BAIJIAHAO: '百家号',
  TOUTIAO: '今日头条',
  XIAOHONGSHU: '小红书',
};

const STATUS_LABELS: Record<string, string> = {
  PENDING: '等待中',
  WAITING_FOR_BROWSER: '等待浏览器',
  RUNNING: '执行中',
  DRAFT_CREATED: '草稿已创建',
  FAILED: '失败',
};

const STATUS_TONE: Record<string, 'default' | 'warning' | 'info' | 'success' | 'danger'> = {
  PENDING: 'default',
  WAITING_FOR_BROWSER: 'warning',
  RUNNING: 'info',
  DRAFT_CREATED: 'success',
  FAILED: 'danger',
};

export function PublicationJobStatus({ jobId }: PublicationJobStatusProps) {
  const [job, setJob] = useState<PublicationJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchJob = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/publication-executor/jobs/${encodeURIComponent(jobId)}`);
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || '无法加载同步任务');
      }
      const data = await response.json();
      setJob(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    void fetchJob();
    const interval = setInterval(() => {
      if (job?.status === 'PENDING' || job?.status === 'WAITING_FOR_BROWSER' || job?.status === 'RUNNING') {
        void fetchJob();
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [fetchJob, job?.status]);

  if (loading) {
    return <p className="cp-placeholder-note">正在加载同步状态…</p>;
  }

  if (error) {
    return (
      <div className="cp-feedback cp-feedback-error">
        <strong>加载失败</strong>
        <p>{error}</p>
        <button className="cp-button" onClick={() => void fetchJob()} style={{ marginTop: '8px' }}>
          重试
        </button>
      </div>
    );
  }

  if (!job) return null;

  return (
    <div className="cp-card">
      <div className="cp-section-heading">
        <div>
          <h2>同步状态</h2>
          <p>任务创建于 {new Date(job.createdAt).toLocaleString('zh-CN')}</p>
        </div>
        <span className={`status-tag ${job.status !== 'PENDING' ? `status-tag[data-tone="${STATUS_TONE[job.status]}"]` : ''}`}>
          {STATUS_LABELS[job.status] ?? job.status}
        </span>
      </div>

      {job.status === 'WAITING_FOR_BROWSER' && (
        <div className="notice notice-warning" style={{ marginBottom: '16px' }}>
          <p>正在等待浏览器响应，请在 Chrome 中打开 Wechatsync 扩展。</p>
        </div>
      )}

      <div className="cp-table-wrap">
        <table className="cp-data-table">
          <thead>
            <tr>
              <th>平台</th>
              <th>状态</th>
              <th>草稿链接</th>
            </tr>
          </thead>
          <tbody>
            {job.platformResults.map((result) => (
              <tr key={result.platform}>
                <td style={{ fontWeight: 600 }}>
                  {PLATFORM_LABELS[result.platform] ?? result.platform}
                </td>
                <td>
                  <span className={`status-tag ${result.status !== 'PENDING' && result.status !== 'RUNNING' ? `status-tag[data-tone="${STATUS_TONE[result.status as keyof typeof STATUS_TONE] ?? 'default'}"]` : ''}`}>
                    {STATUS_LABELS[result.status] ?? result.status}
                  </span>
                </td>
                <td>
                  {result.draftUrl ? (
                    <a
                      href={result.draftUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="cp-button"
                      style={{ fontSize: '12px', padding: '4px 10px', minHeight: '28px' }}
                    >
                      查看草稿
                    </a>
                  ) : result.errorMessage ? (
                    <span style={{ fontSize: '12px', color: 'var(--color-danger)' }}>{result.errorMessage}</span>
                  ) : (
                    <span style={{ fontSize: '12px', color: 'var(--color-ink-500)' }}>—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(job.status === 'PENDING' || job.status === 'WAITING_FOR_BROWSER' || job.status === 'RUNNING') && (
        <p style={{ marginTop: '12px', fontSize: '12px', color: 'var(--color-ink-500)' }}>
          页面将在 5 秒后自动刷新检测最新状态…
        </p>
      )}
    </div>
  );
}
