import { AccountRegistrationPanel, type AccountPlatformOption } from "@/components/account-keyword-runtime";
import { OpsAccountReadPanel, OpsPageHeader, opsPageStyles } from "@/components/ops-runtime";
import { ACCOUNT_PLATFORM_REGISTRY } from "@/runtime/accounts/platform-registry";

const platforms: readonly AccountPlatformOption[] = ACCOUNT_PLATFORM_REGISTRY.map((item) => ({ code: item.code, label: item.displayName, type: item.accountType }));
const aiPlatforms = platforms.filter((item) => item.type === "AI_PLATFORM_ACCOUNT");
const contentPlatforms = platforms.filter((item) => item.type === "CONTENT_PLATFORM_ACCOUNT");

export default function Page(){return <><OpsPageHeader title="账号中心" description="查看并登记平台自有的国内 AI 平台与内容平台账号。凭证配置通过独立安全流程完成。"/><OpsAccountReadPanel/><section className={opsPageStyles.panel}><h2>AI 平台账号</h2><p className={opsPageStyles.muted}>支持豆包、通义千问、DeepSeek 和腾讯元宝。第一版不提供自动登录。</p><AccountRegistrationPanel platforms={aiPlatforms} ownership="PLATFORM_OWNED"/></section><section className={opsPageStyles.panel}><h2>内容平台账号</h2><p className={opsPageStyles.muted}>支持 12 个国内内容平台。登记后凭证状态默认为待配置，不会在本页面保存敏感信息。</p><AccountRegistrationPanel platforms={contentPlatforms} ownership="PLATFORM_OWNED"/></section></>}
