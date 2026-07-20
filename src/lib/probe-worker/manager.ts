import { ProbeWorkerClient, type SessionConfig } from "./client";

const workers = new Map<string, ProbeWorkerClient>();

export async function getWorkerSession(
  sessionId: string, 
  config?: SessionConfig
): Promise<ProbeWorkerClient> {
  let worker = workers.get(sessionId);
  if (!worker) {
    worker = new ProbeWorkerClient();
    await worker.init(config);
    workers.set(sessionId, worker);
  }
  return worker;
}

export async function closeWorkerSession(sessionId: string): Promise<void> {
  const worker = workers.get(sessionId);
  if (worker) {
    await worker.shutdown();
    workers.delete(sessionId);
  }
}

export async function closeAllSessions(): Promise<void> {
  const closePromises = Array.from(workers.keys()).map(id => closeWorkerSession(id));
  await Promise.all(closePromises);
}
