'use client';

import { use, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { SimpleProbe } from '@/components/detection-publication-ui/SimpleProbe';
import { DetectionRunView } from '@/components/detection-publication-ui/DetectionRunView';

interface PageProps {
  params: Promise<{
    agencySlug: string;
    projectId: string;
  }>;
}

interface ProjectInfo {
  projectId: string;
  availableQuestions: Array<{ id: string; question: string }>;
}

const MOCK_QUESTIONS: Array<{ id: string; question: string }> = [];

export default function SimpleDetectionPage({ params }: PageProps) {
  const { projectId } = use(params);
  const searchParams = useSearchParams();
  const runId = searchParams.get('runId');
  const [refreshKey, setRefreshKey] = useState(0);

  const projectInfo: ProjectInfo = {
    projectId,
    availableQuestions: MOCK_QUESTIONS,
  };

  return (
    <>
      <header className="cp-page-header">
        <div>
          <p className="eyebrow">代理商工作台</p>
          <h1>国内 AI 简单探测</h1>
          <span>选择平台登录后，输入问题进行探测，查看原始回答。</span>
        </div>
      </header>

      {runId ? (
        <DetectionRunView runId={runId} projectId={projectId} />
      ) : (
        <div className="cp-stack">
          <SimpleProbe
            projectId={projectId}
            availableQuestions={projectInfo.availableQuestions}
            onProbeComplete={() => setRefreshKey((k) => k + 1)}
          />

          <div className="cp-card">
            <DetectionRunList projectId={projectId} />
          </div>
        </div>
      )}
    </>
  );
}

// Inline simple DetectionRunList for this page
import { useCallback, useEffect } from 'react';

interface Task {
  id: string;
  platform: string;
  question: string;
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  answerText?: string | null;
  brandMentioned?: boolean | null;
  matchedTerms?: string[] | null;
}

interface DetectionRun {
  id: string;
  name: string;
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  platforms: string[];
  createdAt: string;
  tasks: Task[];
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

function DetectionRunList({ projectId }: { projectId: string }) {
  const [runs, setRuns] = useState<DetectionRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);

  const fetchRuns = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/detection/runs?projectId=${encodeURIComponent(projectId)}`);
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || '无法加载探测记录');
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
    return <p className="cp-placeholder-note">正在加载探测记录…</p>;
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
      <div>
        <h2 style={{ margin: '0 0 16px', fontSize: '16px' }}>探测历史</h2>
        <div className="state-panel">
          <h2>还没有探测记录</h2>
          <p>在下方选择平台和问题，开始探测。</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2 style={{ margin: '0 0 16px', fontSize: '16px' }}>探测历史</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {runs.map((run) => (
          <div
            key={run.id}
            style={{
              border: '1px solid var(--color-border)',
              borderRadius: '8px',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '12px 16px',
                cursor: 'pointer',
                background: expandedRunId === run.id ? '#f8f9fb' : '#fff',
              }}
              onClick={() => setExpandedRunId(expandedRunId === run.id ? null : run.id)}
            >
              <span style={{ fontSize: '12px', color: 'var(--color-ink-500)', minWidth: '80px' }}>
                {new Date(run.createdAt).toLocaleDateString('zh-CN')}
              </span>
              <span style={{ fontWeight: 600, flex: 1 }}>{run.platforms.map(p => PLATFORM_LABELS[p] || p).join('、')}</span>
              <span className="status-tag" data-tone={run.status === 'SUCCEEDED' ? 'success' : run.status === 'FAILED' ? 'danger' : 'info'}>
                {STATUS_LABELS[run.status] || run.status}
              </span>
              <span style={{ color: 'var(--color-ink-500)', fontSize: '12px' }}>
                {expandedRunId === run.id ? '▲' : '▼'}
              </span>
            </div>

            {expandedRunId === run.id && (
              <div style={{ padding: '12px 16px', borderTop: '1px solid var(--color-border)', background: '#fff' }}>
                {run.tasks.length === 0 ? (
                  <p className="cp-placeholder-note">暂无任务详情</p>
                ) : (
                  <div className="cp-table-wrap">
                    <table className="cp-data-table">
                      <thead>
                        <tr>
                          <th>问题</th>
                          <th>平台</th>
                          <th>品牌提及</th>
                          <th>匹配词</th>
                          <th>原始回答</th>
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
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
