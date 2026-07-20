'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';

interface DetectionRunCreateProps {
  projectId: string;
  projectName: string;
  availableQuestions: Array<{ id: string; question: string }>;
  onCreated?: (runId: string) => void;
}

const AVAILABLE_PLATFORMS = [
  { code: 'DOUBAO', name: '豆包' },
  { code: 'QWEN', name: '通义千问' },
  { code: 'DEEPSEEK', name: 'DeepSeek' },
  { code: 'YUANBAO', name: '腾讯元宝' },
] as const;

const MAX_QUESTIONS = 10;
const DEFAULT_QUESTION_COUNT = 5;

export function DetectionRunCreate({ projectId, projectName, availableQuestions, onCreated }: DetectionRunCreateProps) {
  const [name, setName] = useState('');
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    const defaultQuestions = availableQuestions.slice(0, DEFAULT_QUESTION_COUNT);
    defaultQuestions.forEach((q) => initial.add(q.id));
    return initial;
  });
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<string>>(() => new Set(['DOUBAO']));
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [createdRunId, setCreatedRunId] = useState<string | null>(null);

  function toggleQuestion(questionId: string) {
    setSelectedQuestionIds((prev) => {
      const next = new Set(prev);
      if (next.has(questionId)) {
        next.delete(questionId);
      } else if (next.size < MAX_QUESTIONS) {
        next.add(questionId);
      }
      return next;
    });
  }

  function togglePlatform(platformCode: string) {
    setSelectedPlatforms((prev) => {
      const next = new Set(prev);
      if (next.has(platformCode)) {
        if (next.size > 1) {
          next.delete(platformCode);
        }
      } else {
        next.add(platformCode);
      }
      return next;
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) {
      setMessage({ type: 'error', text: '请输入任务名称' });
      return;
    }
    if (selectedQuestionIds.size === 0) {
      setMessage({ type: 'error', text: '请至少选择一个用户问题' });
      return;
    }
    if (selectedPlatforms.size === 0) {
      setMessage({ type: 'error', text: '请至少选择一个检测平台' });
      return;
    }

    setSubmitting(true);
    setMessage(null);

    try {
      const selectedQuestions = availableQuestions
        .filter((q) => selectedQuestionIds.has(q.id))
        .map((q) => q.question);

      const response = await fetch('/api/detection/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          name: name.trim(),
          questions: selectedQuestions,
          platforms: Array.from(selectedPlatforms),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setMessage({ type: 'error', text: data.message || '创建失败，请重试' });
        return;
      }

      const runId = data.runId || data.id;
      setCreatedRunId(runId);
      setMessage({ type: 'success', text: '探测任务已创建' });
      onCreated?.(runId);
    } catch {
      setMessage({ type: 'error', text: '网络错误，请重试' });
    } finally {
      setSubmitting(false);
    }
  }

  if (createdRunId) {
    return (
      <div className="cp-card">
        <div className="cp-section-heading">
          <div>
            <h2>创建探测任务</h2>
            <p>{projectName}</p>
          </div>
        </div>
        <div className="cp-feedback cp-feedback-success">
          <strong>探测任务已创建</strong>
          <p>任务正在执行中，可以在下方查看进度。</p>
        </div>
        <p className="cp-form-actions" style={{ marginTop: '16px' }}>
          <Link href={`?runId=${createdRunId}`} className="cp-button cp-button-primary">
            查看任务
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="cp-card">
      <div className="cp-section-heading">
        <div>
          <h2>创建探测任务</h2>
          <p>{projectName}</p>
        </div>
      </div>

      <form className="cp-form" onSubmit={handleSubmit}>
        <div className="cp-form-grid">
          <div className="cp-field">
            <label className="cp-field-label">
              任务名称 <b>*</b>
            </label>
            <input
              type="text"
              className="cp-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：2024年Q3品牌探测"
              required
            />
          </div>
        </div>

        <fieldset style={{ border: 'none', padding: 0, margin: '0 0 16px' }}>
          <legend className="cp-field-label" style={{ marginBottom: '8px' }}>
            检测平台（至少选一个）
          </legend>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            {AVAILABLE_PLATFORMS.map((platform) => (
              <label key={platform.code} style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={selectedPlatforms.has(platform.code)}
                  onChange={() => togglePlatform(platform.code)}
                />
                {platform.name}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset style={{ border: 'none', padding: 0, margin: '0 0 16px' }}>
          <legend className="cp-field-label" style={{ marginBottom: '8px' }}>
            用户问题（最多选{MAX_QUESTIONS}个，已选{selectedQuestionIds.size}个）
          </legend>
          <div style={{ display: 'grid', gap: '8px', maxHeight: '240px', overflowY: 'auto', padding: '4px' }}>
            {availableQuestions.length === 0 ? (
              <p className="cp-placeholder-note">该项目暂无用户问题，请先在「用户问题」页面确认问题。</p>
            ) : (
              availableQuestions.map((item) => (
                <label
                  key={item.id}
                  style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: 'pointer', padding: '6px 8px', borderRadius: '4px', background: selectedQuestionIds.has(item.id) ? '#f0f4ff' : 'transparent' }}
                >
                  <input
                    type="checkbox"
                    checked={selectedQuestionIds.has(item.id)}
                    onChange={() => toggleQuestion(item.id)}
                    disabled={!selectedQuestionIds.has(item.id) && selectedQuestionIds.size >= MAX_QUESTIONS}
                  />
                  <span style={{ fontSize: '13px', color: 'var(--color-ink-700)' }}>{item.question}</span>
                </label>
              ))
            )}
          </div>
        </fieldset>

        {message && (
          <div className={`cp-feedback ${message.type === 'success' ? 'cp-feedback-success' : 'cp-feedback-error'}`}>
            {message.text}
          </div>
        )}

        <div className="cp-form-actions">
          <button type="submit" className="cp-button cp-button-primary" disabled={submitting}>
            {submitting ? '创建中…' : '创建探测任务'}
          </button>
        </div>
      </form>
    </div>
  );
}
