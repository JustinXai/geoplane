'use client';

import { use } from 'react';
import { PublicationExecutorPanel } from '@/components/detection-publication-ui/PublicationExecutorPanel';
import { FeatureGate } from '@/components/detection-publication-ui/FeatureGate';

interface PageProps {
  params: Promise<{
    agencySlug: string;
    projectId: string;
  }>;
}

interface DraftPackage {
  id: string;
  title: string;
  channelNeutralContentPackageId: string;
  status: string;
}

const MOCK_DRAFTS: DraftPackage[] = [];

export default function PublicationPage({ params }: PageProps) {
  const { projectId } = use(params);

  return (
    <>
      <header className="cp-page-header">
        <div>
          <p className="eyebrow">代理商工作台</p>
          <h1>草稿同步</h1>
          <span>将审核通过的稿件同步到各平台草稿箱。</span>
        </div>
      </header>

      <FeatureGate feature="publication" fallback={
        <div className="cp-card">
          <div className="cp-callout">
            <strong>功能未启用</strong>
            <p>草稿同步功能目前暂未启用。如需使用，请联系平台管理员开启。</p>
          </div>
        </div>
      }>
        <div className="cp-stack">
          {MOCK_DRAFTS.length === 0 ? (
            <div className="cp-card">
              <div className="state-panel">
                <h2>暂无待同步的稿件</h2>
                <p>请在「内容审核」页面确认稿件通过审核后，再进行草稿同步。</p>
              </div>
            </div>
          ) : (
            MOCK_DRAFTS.map((draft) => (
              <PublicationExecutorPanel
                key={draft.id}
                publishPackageId={draft.id}
                channelNeutralContentPackageId={draft.channelNeutralContentPackageId}
                articleTitle={draft.title}
              />
            ))
          )}
        </div>
      </FeatureGate>
    </>
  );
}
