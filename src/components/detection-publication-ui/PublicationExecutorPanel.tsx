'use client';

import { useCallback, useEffect, useState } from 'react';
import { PublicationJobStatus } from './PublicationJobStatus';

interface PlatformInfo {
  code: string;
  name: string;
  loggedIn: boolean;
}

interface BridgeStatus {
  connected: boolean;
}

interface PublicationExecutorPanelProps {
  publishPackageId: string;
  channelNeutralContentPackageId: string;
  articleTitle: string;
}

const AVAILABLE_PLATFORMS = [
  { code: 'WECHAT_OFFICIAL_ACCOUNT', name: '微信公众号' },
  { code: 'ZHIHU', name: '知乎' },
  { code: 'BAIJIAHAO', name: '百家号' },
  { code: 'TOUTIAO', name: '今日头条' },
  { code: 'XIAOHONGSHU', name: '小红书' },
] as const;

export function PublicationExecutorPanel({ publishPackageId, channelNeutralContentPackageId, articleTitle }: PublicationExecutorPanelProps) {
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus | null>(null);
  const [platforms, setPlatforms] = useState<PlatformInfo[]>([]);
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<string>>(new Set());
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'warning'; text: string } | null>(null);
  const [createdJobId, setCreatedJobId] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    setLoadingStatus(true);
    try {
      const [statusRes, platformsRes] = await Promise.all([
        fetch('/api/publication-executor/status'),
        fetch('/api/publication-executor/platforms'),
      ]);

      if (statusRes.ok) {
        const data = await statusRes.json();
        setBridgeStatus(data);
      }

      if (platformsRes.ok) {
        const data = await platformsRes.json();
        setPlatforms(Array.isArray(data) ? data : data.platforms || []);
      }
    } catch {
      setMessage({ type: 'error', text: '无法获取状态，请检查网络' });
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  function togglePlatform(platformCode: string) {
    setSelectedPlatforms((prev) => {
      const next = new Set(prev);
      if (next.has(platformCode)) {
        next.delete(platformCode);
      } else {
        next.add(platformCode);
      }
      return next;
    });
  }

  async function handlePublish() {
    if (selectedPlatforms.size === 0) {
      setMessage({ type: 'warning', text: '请至少选择一个发布平台' });
      return;
    }

    setSubmitting(true);
    setMessage(null);

    try {
      const response = await fetch('/api/publication-executor/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          publishPackageId,
          channelNeutralContentPackageId,
          platforms: Array.from(selectedPlatforms),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setMessage({ type: 'error', text: data.message || '同步失败，请重试' });
        return;
      }

      const jobId = data.jobId || data.id;
      setCreatedJobId(jobId);
      setMessage({ type: 'success', text: '同步任务已创建' });
    } catch {
      setMessage({ type: 'error', text: '网络错误，请重试' });
    } finally {
      setSubmitting(false);
    }
  }

  if (loadingStatus) {
    return <p className="cp-placeholder-note">正在检查同步状态…</p>;
  }

  if (!bridgeStatus?.connected) {
    return (
      <div className="cp-card">
        <div className="cp-section-heading">
          <div>
            <h2>草稿同步</h2>
            <p>{articleTitle}</p>
          </div>
        </div>
        <div className="notice notice-warning">
          <strong>Wechatsync 未连接</strong>
          <p>请在 Chrome 中安装并登录 Wechatsync 扩展后，再进行草稿同步操作。</p>
        </div>
        <button className="cp-button" onClick={() => void fetchStatus()} style={{ marginTop: '12px' }}>
          重新检查
        </button>
      </div>
    );
  }

  return (
    <div className="cp-stack">
      <div className="cp-card">
        <div className="cp-section-heading">
          <div>
            <h2>草稿同步</h2>
            <p>{articleTitle}</p>
          </div>
        </div>

        <fieldset style={{ border: 'none', padding: 0, margin: '0 0 16px' }}>
          <legend className="cp-field-label" style={{ marginBottom: '10px' }}>选择发布平台</legend>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {AVAILABLE_PLATFORMS.map((platform) => {
              const platformInfo = platforms.find((p) => p.code === platform.code);
              const isLoggedIn = platformInfo?.loggedIn ?? false;
              return (
                <label
                  key={platform.code}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '10px 12px',
                    borderRadius: '6px',
                    border: '1px solid var(--color-border)',
                    background: selectedPlatforms.has(platform.code) ? '#f0f4ff' : '#fff',
                    cursor: isLoggedIn ? 'pointer' : 'not-allowed',
                    opacity: isLoggedIn ? 1 : 0.5,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedPlatforms.has(platform.code)}
                    onChange={() => isLoggedIn && togglePlatform(platform.code)}
                    disabled={!isLoggedIn}
                  />
                  <span style={{ fontWeight: 600, flex: 1 }}>{platform.name}</span>
                  {isLoggedIn ? (
                    <span style={{ fontSize: '12px', color: 'var(--color-success)' }}>已登录</span>
                  ) : (
                    <span style={{ fontSize: '12px', color: 'var(--color-warning)' }}>未登录</span>
                  )}
                </label>
              );
            })}
          </div>
        </fieldset>

        {message && (
          <div className={`cp-feedback ${message.type === 'success' ? 'cp-feedback-success' : message.type === 'error' ? 'cp-feedback-error' : ''}`}>
            {message.text}
          </div>
        )}

        <div className="cp-form-actions">
          <button
            className="cp-button cp-button-primary"
            onClick={() => void handlePublish()}
            disabled={submitting || selectedPlatforms.size === 0}
          >
            {submitting ? '同步中…' : '同步到平台草稿箱'}
          </button>
        </div>
      </div>

      {createdJobId && (
        <PublicationJobStatus jobId={createdJobId} />
      )}
    </div>
  );
}
