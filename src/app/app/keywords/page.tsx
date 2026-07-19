"use client";
import { useAsyncData } from "../../../components/runtime/index.js";
import { AsyncSection } from "../../../components/client-runtime/AsyncSection.js";
import { loadActiveProjectKeywords } from "../../../components/client-runtime/endpoints.js";
import { isEmptyArray, toKeywordRows } from "../../../components/client-runtime/view-models.js";
import { UnavailableState } from "../../../components/client-runtime/UnavailableState.js";

export default function KeywordConfirmationPage() {
  const resource = useAsyncData(loadActiveProjectKeywords, { isEmpty: isEmptyArray });
  return <><header className="cp-page-header"><div><p className="eyebrow">客户工作台</p><h1>关键词确认</h1><span>查看当前项目已入库的关键词与用户问题关系。</span></div></header>
    <AsyncSection state={resource.state} onRetry={resource.reload} empty={<p className="cp-list-row cp-list-empty">暂无关键词数据。</p>}>
      {(items) => <ul className="cp-list">{toKeywordRows(items).map((row, index) => <li className="cp-list-row" key={`${row.keyword}-${index}`}><span className="cp-list-title">{row.keyword}</span><span className="cp-list-meta">优先级：{row.priority}</span><p>{row.userQuestions.join("；") || "尚未关联用户问题"}</p></li>)}</ul>}
    </AsyncSection>
    <UnavailableState title="关键词人工确认尚未开放">当前客户接口可以安全读取关键词，但没有提供可定位审核项的读取接口；因此本页不显示无效确认按钮。</UnavailableState>
  </>;
}
