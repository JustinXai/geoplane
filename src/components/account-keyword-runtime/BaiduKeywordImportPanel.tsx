"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import type { Result } from "../../lib/api-client/http.js";
import { accountKeywordApi, fileToBase64, type KeywordImportResult } from "./api.js";
import { ActionFeedback } from "./ActionFeedback.js";

export function BaiduKeywordImportPanel({ projectId, snapshotVersion = 1, onImported }: {
  readonly projectId: string;
  readonly snapshotVersion?: number;
  readonly onImported?: (result: KeywordImportResult) => void;
}): ReactNode {
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<Result<KeywordImportResult> | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) return;
    setPending(true);
    setResult(null);
    try {
      const response = await accountKeywordApi.importBaiduKeywords({ projectId, fileName: file.name, base64: await fileToBase64(file), snapshotVersion });
      setResult(response);
      if (response.ok) onImported?.(response.data);
    } catch {
      setResult({ ok: false, code: "INTERNAL_ERROR", message: "文件读取或网络请求失败" });
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="cp-form" onSubmit={submit}>
      <label>
        百度关键词参考文件
        <input type="file" accept=".csv,.xlsx" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setResult(null); }} disabled={pending} required />
      </label>
      <p className="cp-placeholder-note">仅接受 CSV 或 XLSX，最大 10 MB。系统只保存本次真实导入的可追溯记录，不会补造历史关键词或需求数据。</p>
      <button className="cp-button cp-button-primary" type="submit" disabled={pending || !file}>导入并校验</button>
      <ActionFeedback pending={pending} result={result} successText={result?.ok ? `导入完成：有效 ${result.data.parsedCount} 条，未接收 ${result.data.rejectedCount} 条，重复 ${result.data.duplicateRecordCount} 条。` : "导入完成。"} />
    </form>
  );
}
