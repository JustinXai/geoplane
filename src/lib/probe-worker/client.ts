import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

export type WorkerStatus = "READY" | "LOGIN_PAGE_OPENED" | "LOGIN_STATUS" | "PROBE_COMPLETE" | "PROBE_ERROR" | "ERROR";

export interface WorkerMessage {
  type: WorkerStatus | "SHUTDOWN";
  platform?: string;
  status?: string;
  answer?: string;
  message?: string;
}

export class ProbeWorkerClient {
  private process: ReturnType<typeof spawn> | null = null;
  private resolvers: Map<string, (value: unknown) => void> = new Map();
  private rejecters: Map<string, (reason: Error) => void> = new Map();
  private initialized = false;

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.process = spawn("node", ["scripts/domestic-probe-worker.mjs"], {
        stdio: ["pipe", "pipe", "inherit"],
        env: { ...process.env },
      });

      const rl = createInterface({ input: this.process.stdout!, crlfDelay: Infinity });
      
      rl.on("line", (line: string) => {
        try {
          const msg: WorkerMessage = JSON.parse(line);
          if (msg.type === "READY" && !this.initialized) {
            this.initialized = true;
            resolve();
          }
          
          const resolver = this.resolvers.get(msg.type);
          if (resolver) {
            resolver(msg);
            this.resolvers.delete(msg.type);
          }
        } catch (e) {
          console.error("Worker parse error:", e, line);
        }
      });

      this.process.on("error", reject);
      
      setTimeout(() => {
        if (!this.initialized) {
          reject(new Error("Worker init timeout"));
        }
      }, 10000);
    });
  }

  async send(cmd: Record<string, unknown>): Promise<WorkerMessage> {
    return new Promise((resolve, reject) => {
      if (!this.process) throw new Error("Worker not initialized");
      
      const type = cmd.type as string;
      this.resolvers.set(type, resolve as (value: unknown) => void);
      this.rejecters.set(type, reject);
      
      this.process.stdin!.write(JSON.stringify(cmd) + "\n");
      
      setTimeout(() => {
        if (this.resolvers.has(type)) {
          this.resolvers.delete(type);
          this.rejecters.delete(type);
          reject(new Error(`Command ${type} timeout`));
        }
      }, 120000);
    });
  }

  async shutdown(): Promise<void> {
    if (!this.process) return;
    try {
      await this.send({ type: "SHUTDOWN" });
    } catch {}
    this.process.kill();
    this.process = null;
    this.initialized = false;
  }
}
