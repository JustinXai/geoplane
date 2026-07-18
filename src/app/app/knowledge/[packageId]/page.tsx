/**
 * CLIENT_WORKSPACE_RUNTIME_V1 (Agent D) — enterprise knowledge-base detail route. The route
 * param is the knowledge package id; this thin server wrapper unwraps it and hands off to the
 * client KnowledgePackageDetailView, which wires the real readiness + issues APIs and renders
 * all five async states. (Replaces the C2 fixture-backed detail view.)
 */
import { KnowledgePackageDetailView } from "../../../../components/client-runtime/KnowledgePackageDetailView.js";

export default async function KnowledgeBaseDetailPage({
  params,
}: {
  params: Promise<{ packageId: string }>;
}) {
  const { packageId } = await params;
  return <KnowledgePackageDetailView packageId={packageId} />;
}
