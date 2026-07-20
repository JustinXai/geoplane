'use client';

import { DOMESTIC_DETECTION_ENABLED, PUBLICATION_EXECUTOR_ENABLED } from '@/lib/feature-flags';

interface FeatureGateProps {
  children: React.ReactNode;
  feature: 'detection' | 'publication';
  fallback?: React.ReactNode;
}

export function FeatureGate({ children, feature, fallback = null }: FeatureGateProps) {
  const enabled = feature === 'detection'
    ? DOMESTIC_DETECTION_ENABLED
    : PUBLICATION_EXECUTOR_ENABLED;
  return <>{enabled ? children : fallback}</>;
}
