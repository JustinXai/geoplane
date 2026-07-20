'use client';

import { useState, type FormEvent } from 'react';

interface SimpleProbeProps {
  projectId: string;
  availableQuestions: Array<{ id: string; question: string }>;
  onProbeComplete?: (result: ProbeResult) => void;
}

interface ProbeResult {
  taskId: string;
  platform: string;
  question: string;
  answerText: string;
  brandMentioned: boolean;
  matchedTerms: string[];
  completedAt: string;
}

const PLATFORMS = [
  { code: 'DOUBAO', name: '豆包' },
  { code: 'DEEPSEEK', name: 'DeepSeek' },
] as const;

type PlatformStatus = 'NOT_CONNECTED' | 'WAITING_FOR_LOGIN' | 'CONNECTED' | 'NEEDS_RELOGIN';

const STATUS_ICONS: Record<PlatformStatus, string> = {
  NOT_CONNECTED: '🔴',
  WAITING_FOR_LOGIN: '🟡',
  CONNECTED: '🟢',
  NEEDS_RELOGIN: '🔴',
};

const STATUS_LABELS: Record<PlatformStatus, string> = {
  NOT_CONNECTED: '未连接',
  WAITING_FOR_LOGIN: '等待登录',
  CONNECTED: '已连接',
  NEEDS_RELOGIN: '需要重新登录',
};

export function SimpleProbe({ projectId, availableQuestions, onProbeComplete }: SimpleProbeProps) {
  const [platformStatuses, setPlatformStatuses] = useState<Record<string, PlatformStatus>>({
    DOUBAO: 'NOT_CONNECTED',
    DEEPSEEK: 'NOT_CONNECTED',
  });
  const [selectedPlatform, setSelectedPlatform] = useState<string>('');
  const [selectedQuestionId, setSelectedQuestionId] = useState<string>('');
  const [probing, setProbing] = useState(false);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [currentResult, setCurrentResult] = useState<ProbeResult | null>(null);
  const [openingLogin, setOpeningLogin] = useState<string | null>(null);

  async function handleOpenLoginWindow(platformCode: string) {
    setOpeningLogin(platformCode);
    setPlatformStatuses((prev) => ({ ...prev, [platformCode]: 'WAITING_FOR_LOGIN' }));
    try {
      await fetch(`/api/detection/platforms/${platformCode}/open-login`, { method: 'POST' });
    } catch {
      setProbeError('打开登录窗口失败');
    } finally {
      setOpeningLogin(null);
    }
  }

  async function handleCheckStatus(platformCode: string) {
    try {
      const response = await fetch(`/api/detection/platforms/${platformCode}/status`);
      if (response.ok) {
        const data = await response.json();
        setPlatformStatuses((prev) => ({ ...prev, [platformCode]: data.status }));
      }
    } catch {
      setProbeError('检查状态失败');
    }
  }

  async function handleStartProbe(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedPlatform || !selectedQuestionId) {
      setProbeError('请选择平台和问题');
      return;
    }

    const platformStatus = platformStatuses[selectedPlatform];
    if (platformStatus !== 'CONNECTED') {
      setProbeError('请先登录该平台');
      return;
    }

    const question = availableQuestions.find((q) => q.id === selectedQuestionId);
    if (!question) {
      setProbeError('请选择问题');
      return;
    }

    setProbing(true);
    setProbeError(null);
    setCurrentResult(null);

    try {
      const runResponse = await fetch('/api/detection/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          platforms: [selectedPlatform],
          questions: [question.question],
        }),
      });

      if (!runResponse.ok) {
        const data = await runResponse.json();
        throw new Error(data.message || '创建探测任务失败');
      }

      const runData = await runResponse.json();
      const runId = runData.runId || runData.id;

      // Poll for task completion
      const task = await pollForTaskCompletion(runId, selectedPlatform);
      if (!task) {
        throw new Error('探测超时');
      }

      const result: ProbeResult = {
        taskId: task.id,
        platform: selectedPlatform,
        question: question.question,
        answerText: task.answerText || '',
        brandMentioned: task.brandMentioned ?? false,
        matchedTerms: task.matchedTerms || [],
        completedAt: new Date().toISOString(),
      };

      setCurrentResult(result);
      onProbeComplete?.(result);
    } catch (err) {
      setProbeError(err instanceof Error ? err.message : '探测失败');
    } finally {
      setProbing(false);
    }
  }

  async function pollForTaskCompletion(runId: string, platform: string): Promise<{ id: string; answerText: string | null; brandMentioned: boolean | null; matchedTerms: string[] } | null> {
    const maxAttempts = 60;
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const response = await fetch(`/api/detection/runs/${runId}`);
        if (response.ok) {
          const data = await response.json();
          const task = data.tasks?.find((t: { platform: string }) => t.platform === platform);
          if (task && (task.status === 'SUCCEEDED' || task.status === 'FAILED')) {
            return task;
          }
        }
      } catch {
        // Continue polling
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    return null;
  }

  return (
    <div className="cp-stack">
      {/* Platform Status Cards */}
      <div className="cp-card">
        <h2 style={{ margin: '0 0 16px', fontSize: '16px' }}>平台连接状态</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
          {PLATFORMS.map((platform) => {
            const status = platformStatuses[platform.code] || 'NOT_CONNECTED';
            return (
              <div
                key={platform.code}
                style={{
                  padding: '16px',
                  borderRadius: '8px',
                  border: '1px solid var(--color-border)',
                  background: status === 'CONNECTED' ? '#f0fbf4' : '#fff',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                  <span style={{ fontSize: '20px' }}>{STATUS_ICONS[status]}</span>
                  <span style={{ fontWeight: 600 }}>{platform.name}</span>
                </div>
                <div style={{ fontSize: '12px', color: 'var(--color-ink-500)', marginBottom: '12px' }}>
                  {STATUS_LABELS[status]}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <button
                    className="cp-button"
                    style={{ fontSize: '12px', padding: '6px 10px' }}
                    onClick={() => void handleOpenLoginWindow(platform.code)}
                    disabled={openingLogin === platform.code}
                  >
                    {openingLogin === platform.code ? '打开中…' : '打开登录窗口'}
                  </button>
                  <button
                    className="cp-button"
                    style={{ fontSize: '12px', padding: '6px 10px' }}
                    onClick={() => void handleCheckStatus(platform.code)}
                  >
                    检查登录状态
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Probe Form */}
      <div className="cp-card">
        <h2 style={{ margin: '0 0 16px', fontSize: '16px' }}>开始探测</h2>
        <form className="cp-form" onSubmit={handleStartProbe}>
          <div className="cp-form-grid">
            <div className="cp-field">
              <label className="cp-field-label">选择平台</label>
              <select
                className="cp-input"
                value={selectedPlatform}
                onChange={(e) => setSelectedPlatform(e.target.value)}
                required
              >
                <option value="">请选择平台</option>
                {PLATFORMS.map((p) => {
                  const status = platformStatuses[p.code] || 'NOT_CONNECTED';
                  return (
                    <option key={p.code} value={p.code} disabled={status !== 'CONNECTED'}>
                      {p.name} {status !== 'CONNECTED' ? `(${STATUS_LABELS[status]})` : ''}
                    </option>
                  );
                })}
              </select>
            </div>

            <div className="cp-field">
              <label className="cp-field-label">选择问题</label>
              <select
                className="cp-input"
                value={selectedQuestionId}
                onChange={(e) => setSelectedQuestionId(e.target.value)}
                required
                disabled={availableQuestions.length === 0}
              >
                <option value="">请选择问题</option>
                {availableQuestions.map((q) => (
                  <option key={q.id} value={q.id}>{q.question}</option>
                ))}
              </select>
            </div>
          </div>

          {probeError && (
            <div className="cp-feedback cp-feedback-error">{probeError}</div>
          )}

          <div className="cp-form-actions">
            <button
              type="submit"
              className="cp-button cp-button-primary"
              disabled={probing || !selectedPlatform || !selectedQuestionId}
            >
              {probing ? '探测中…' : '开始探测'}
            </button>
          </div>
        </form>

        {availableQuestions.length === 0 && (
          <p className="cp-placeholder-note" style={{ marginTop: '12px' }}>
            该项目暂无用户问题，请先在「用户问题」页面添加问题。
          </p>
        )}
      </div>

      {/* Result Display */}
      {currentResult && (
        <div className="cp-card">
          <h2 style={{ margin: '0 0 16px', fontSize: '16px' }}>探测结果</h2>
          <div style={{ display: 'grid', gap: '12px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: '8px' }}>
              <span style={{ color: 'var(--color-ink-500)', fontWeight: 600 }}>问题</span>
              <span>{currentResult.question}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: '8px' }}>
              <span style={{ color: 'var(--color-ink-500)', fontWeight: 600 }}>平台</span>
              <span>{PLATFORMS.find((p) => p.code === currentResult.platform)?.name}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: '8px' }}>
              <span style={{ color: 'var(--color-ink-500)', fontWeight: 600 }}>品牌提及</span>
              <span>{currentResult.brandMentioned ? '✅ 是' : '❌ 否'}</span>
            </div>
            {currentResult.matchedTerms.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: '8px' }}>
                <span style={{ color: 'var(--color-ink-500)', fontWeight: 600 }}>匹配词</span>
                <span>{currentResult.matchedTerms.join('、')}</span>
              </div>
            )}
            <details style={{ marginTop: '8px' }}>
              <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--color-ink-500)' }}>
                原始回答（点击展开）
              </summary>
              <div style={{ marginTop: '8px', padding: '12px', background: '#f8f9fb', borderRadius: '6px', whiteSpace: 'pre-wrap', fontSize: '13px' }}>
                {currentResult.answerText || '(无回答)'}
              </div>
            </details>
            <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: '8px', marginTop: '8px' }}>
              <span style={{ color: 'var(--color-ink-500)', fontWeight: 600 }}>完成时间</span>
              <span style={{ fontSize: '13px', color: 'var(--color-ink-500)' }}>
                {new Date(currentResult.completedAt).toLocaleString('zh-CN')}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
