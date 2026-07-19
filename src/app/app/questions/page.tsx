"use client";

import { useAsyncData } from "../../../components/runtime/index.js";
import { AsyncSection } from "../../../components/client-runtime/AsyncSection.js";
import { loadActiveProjectKeywords } from "../../../components/client-runtime/endpoints.js";
import { isEmptyArray, toKeywordRows } from "../../../components/client-runtime/view-models.js";
import { UnavailableState } from "../../../components/client-runtime/UnavailableState.js";

export default function UserQuestionConfirmationPage() {
  const resource = useAsyncData(loadActiveProjectKeywords, { isEmpty: isEmptyArray });
  return <><header className="cp-page-header"><div><p className="eyebrow">客户工作台</p><h1>用户问题确认</h1><span>核对真实关键词数据已关联的用户问题。</span></div></header>
    <AsyncSection state={resource.state} onRetry={resource.reload} empty={<p className="cp-list-row cp-list-empty">暂无待查看的用户问题。</p>}>
      {(items) => <ul className="cp-list">{toKeywordRows(items).flatMap((row) => row.userQuestions.map((question) => <li className="cp-list-row" key={`${row.keyword}-${question}`}><span className="cp-list-title">{question}</span><span className="cp-list-meta">关联关键词：{row.keyword}</span></li>))}</ul>}
    </AsyncSection>
    <UnavailableState title="用户问题确认尚未开放">当前读取接口不返回可审核项标识，无法安全提交确认或修改决定。本页只展示已入库关系。</UnavailableState>
  </>;
}
