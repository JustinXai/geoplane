"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import type { Result } from "../../lib/api-client/http.js";
import type { AccountOwnership, AccountType, PlatformAccount } from "../../runtime/accounts/entities.js";
import { accountKeywordApi } from "./api.js";
import { ActionFeedback } from "./ActionFeedback.js";
import { ownershipLabel } from "./labels.js";

export interface AccountPlatformOption {
  readonly code: string;
  readonly label: string;
  readonly type: AccountType;
}

export function AccountRegistrationPanel({ platforms, ownership, agencyOrganizationId, clientOrganizationId, onRegistered }: {
  readonly platforms: readonly AccountPlatformOption[];
  readonly ownership: AccountOwnership;
  readonly agencyOrganizationId?: string;
  readonly clientOrganizationId?: string;
  readonly onRegistered?: () => void;
}): ReactNode {
  const [platformCode, setPlatformCode] = useState(platforms[0]?.code ?? "");
  const [displayLabel, setDisplayLabel] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<Result<Omit<PlatformAccount, "secretReference">> | null>(null);
  const selected = platforms.find((item) => item.code === platformCode);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !displayLabel.trim()) return;
    setPending(true);
    setResult(null);
    try {
      const response = await accountKeywordApi.registerAccount({
        platformCode: selected.code,
        displayLabel: displayLabel.trim(),
        accountType: selected.type,
        ownership,
        ...(agencyOrganizationId ? { agencyOrganizationId } : {}),
        ...(clientOrganizationId ? { clientOrganizationId } : {}),
      });
      setResult(response);
      if (response.ok) {
        setDisplayLabel("");
        onRegistered?.();
      }
    } catch {
      setResult({ ok: false, code: "INTERNAL_ERROR", message: "网络请求失败" });
    } finally {
      setPending(false);
    }
  }

  if (platforms.length === 0) {
    return <div className="cp-callout">当前没有可登记的平台账号类型，请联系平台运营人员配置。</div>;
  }

  return (
    <form className="cp-form" onSubmit={submit}>
      <div className="cp-form-grid">
        <label>
          平台
          <select value={platformCode} onChange={(event) => setPlatformCode(event.target.value)} disabled={pending}>
            {platforms.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
          </select>
        </label>
        <label>
          账号名称
          <input value={displayLabel} onChange={(event) => setDisplayLabel(event.target.value)} placeholder="例如：品牌内容运营账号" maxLength={100} disabled={pending} required />
        </label>
      </div>
      <p className="cp-placeholder-note">账号归属：{ownershipLabel[ownership]}。敏感凭据由安全配置流程单独管理，本页面不接收密码、令牌或密钥。</p>
      <button className="cp-button cp-button-primary" type="submit" disabled={pending || !displayLabel.trim()}>登记账号</button>
      <ActionFeedback pending={pending} result={result} successText="账号已登记，可继续完成授权和项目分配。" />
    </form>
  );
}
