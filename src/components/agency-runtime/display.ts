import type { ArticleDeliveryStatusV1, OpportunityStatusV1 } from "../../runtime/api-contracts/index.js";

const OPPORTUNITY_STATUS: Record<OpportunityStatusV1, string> = {
  PROPOSED: "待校验", VALIDATED: "待确认", CONFIRMED: "已确认", REJECTED: "未通过",
};
const DELIVERY_STATUS: Record<ArticleDeliveryStatusV1, string> = {
  IN_PRODUCTION: "生产中", IN_REVIEW: "待审核", APPROVED: "已批准", DELIVERED: "已交付",
};

export const opportunityStatusLabel = (status: OpportunityStatusV1): string => OPPORTUNITY_STATUS[status];
export const deliveryStatusLabel = (status: ArticleDeliveryStatusV1): string => DELIVERY_STATUS[status];
export function dateLabel(value: string | null): string {
  return value === null ? "暂无" : new Date(value).toLocaleString("zh-CN");
}
