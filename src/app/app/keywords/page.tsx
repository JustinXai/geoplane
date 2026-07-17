/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: docs/architecture/SYSTEM_BLUEPRINT_V1.md (business core item 2,
 *   "Keyword and user-question mapping")
 * reconstruction_reason: no original page code recoverable beyond the 7 files already in
 *   recovered/partial-source/
 * original_file_unavailable: true
 *
 * Checkpoint C2: keyword & user-question mapping view for the CLIENT workspace. Fixture
 * data only (src/app/app/_fixtures.ts) - no real customer data, no database connection.
 */
import { KEYWORD_QUESTION_ITEMS } from "../_fixtures";

export default function KeywordQuestionPage() {
  return (
    <>
      <header className="cp-page-header">
        <div>
          <p className="eyebrow">客户工作台</p>
          <h1>关键词与用户问题</h1>
          <span>占位数据 - 无真实客户数据、无数据库连接。</span>
        </div>
      </header>
      <ul className="cp-list">
        {KEYWORD_QUESTION_ITEMS.map((item) => (
          <li className="cp-list-row" key={item.referenceCode}>
            <span className="cp-list-title">{item.keyword}</span>
            <span className="cp-list-meta">
              参考编号 {item.referenceCode} · 意图：{item.intentLabel} · 优先级：{item.priorityLabel}
            </span>
            <ul>
              {item.relatedQuestions.map((question) => (
                <li key={question}>{question}</li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </>
  );
}
