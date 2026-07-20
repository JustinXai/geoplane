import { ProbeWorkerClient } from "./client";

const workers = new Map<string, ProbeWorkerClient>();

export async function getWorkerSession(sessionId: string): Promise<ProbeWorkerClient> {
  let worker = workers.get(sessionId);
  if (!worker) {
    worker = new ProbeWorkerClient();
    await worker.init();
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
