'use client';

import { use } from 'react';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { DetectionRunList } from '@/components/detection-publication-ui/DetectionRunList';
import { DetectionRunCreate } from '@/components/detection-publication-ui/DetectionRunCreate';
import { DetectionRunView } from '@/components/detection-publication-ui/DetectionRunView';

interface PageProps {
  params: Promise<{
    agencySlug: string;
    projectId: string;
  }>;
}

interface ProjectInfo {
  projectId: string;
  projectName: string;
  clientOrganizationId: string;
  availableQuestions: Array<{ id: string; question: string }>;
}

const MOCK_QUESTIONS: Array<{ id: string; question: string }> = [];

export default function DetectionPage({ params }: PageProps) {
  const { projectId } = use(params);
  const searchParams = useSearchParams();
  const runId = searchParams.get('runId');
  const [refreshKey, setRefreshKey] = useState(0);

  const projectInfo: ProjectInfo = {
    projectId,
    projectName: '项目详情',
    clientOrganizationId: '',
    availableQuestions: MOCK_QUESTIONS,
  };

  function handleCreated(newRunId: string) {
    setRefreshKey((k) => k + 1);
  }

  return (
    <>
      <header className="cp-page-header">
        <div>
          <p className="eyebrow">代理商工作台</p>
          <h1>国内 AI 探测</h1>
          <span>对国内 AI 平台进行品牌探测，检测品牌提及、推荐情况和回答位置。</span>
        </div>
      </header>

      {runId ? (
        <DetectionRunView
          runId={runId}
          clientOrganizationId={projectInfo.clientOrganizationId}
          projectId={projectId}
        />
      ) : (
        <div className="cp-stack">
          <DetectionRunCreate
            projectId={projectId}
            projectName={projectInfo.projectName}
            availableQuestions={projectInfo.availableQuestions}
            onCreated={handleCreated}
          />

          <div className="cp-card">
            <div className="cp-section-heading">
              <div>
                <h2>探测历史</h2>
                <p>查看该项目过往的探测任务记录</p>
              </div>
            </div>
            <DetectionRunList
              key={refreshKey}
              clientOrganizationId={projectInfo.clientOrganizationId}
              projectId={projectId}
            />
          </div>
        </div>
      )}
    </>
  );
}
