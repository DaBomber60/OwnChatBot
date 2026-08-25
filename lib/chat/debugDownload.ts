export type DebugLogKind = 'request' | 'response';

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

/**
 * Fetch a stored request/response log and save it as JSON.
 * Returns a user-facing message on failure, or null on success.
 */
export async function downloadSessionLog(
  kind: DebugLogKind,
  sessionId: number | string,
): Promise<string | null> {
  try {
    const res = await fetch(`/api/chat/${kind}-log/${sessionId}`);
    if (!res.ok) {
      return res.status === 404
        ? `No ${kind} has been recorded for this chat yet.`
        : `Could not download the last ${kind} (HTTP ${res.status}).`;
    }
    const payload = await res.json();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    // Timestamped so repeated downloads don't overwrite each other.
    a.download = `ownchatbot-${kind}-${sessionId}-${timestamp()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    return null;
  } catch {
    return `Could not download the last ${kind}.`;
  }
}
