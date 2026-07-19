/**
 * Compatibility component retained for older imports. It intentionally exposes no
 * interaction: a confirmation control is rendered only where a real command endpoint
 * and a server-issued review reference are both available.
 */
export function ClientConfirmationControl({ subjectLabel }: { subjectLabel: string }) {
  return (
    <p className="cp-placeholder-note" role="status">
      {subjectLabel}确认功能尚未开放
    </p>
  );
}
