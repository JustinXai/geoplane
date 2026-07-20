"use client";

import { AgencyUnavailable } from "@/components/agency-runtime";
import { ArticleBriefCreationPanel } from "@/components/agency-content-runtime/ArticleBriefCreationPanel";
import { ArticleBriefList } from "@/components/agency-content-runtime/ArticleBriefList";
import { ArticleDraftList } from "@/components/agency-content-runtime/ArticleDraftList";
import { ArticleDraftReviewList } from "@/components/agency-content-runtime/ArticleDraftReviewList";

export default function Page() {
  return (
    <>
      <AgencyUnavailable title="内容生产" description="查看授权客户项目的内容任务和生产进度。" />
      <div className="cp-stack">
        <ArticleBriefCreationPanel />
        <ArticleBriefList />
        <ArticleDraftList />
        <ArticleDraftReviewList />
      </div>
    </>
  );
}
