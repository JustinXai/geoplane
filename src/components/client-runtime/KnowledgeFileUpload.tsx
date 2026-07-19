"use client";

import { useState } from "react";
import { uploadKnowledgeFile } from "./commands.js";
import { useWriteAction, WriteActionFeedback } from "./WriteAction.js";

export function KnowledgeFileUpload({ packageId, onUploaded }: { readonly packageId: string; readonly onUploaded: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const action = useWriteAction((selected: File) => uploadKnowledgeFile({ packageId, file: selected }), onUploaded);
  return <section aria-label="上传企业资料"><h2>上传企业资料</h2>
    <p className="cp-placeholder-note">文件将写入当前知识包；请勿上传密码、访问密钥或其他登录凭据。</p>
    <input type="file" onChange={(event) => setFile(event.target.files?.[0] ?? null)} disabled={action.state.status === "submitting"} />
    <button type="button" className="cp-confirm-button" disabled={file === null || action.state.status === "submitting"} onClick={() => { if (file) action.submit(file); }}>上传资料</button>
    <WriteActionFeedback state={action.state} successLabel="资料已上传并进入知识处理流程。" />
  </section>;
}
