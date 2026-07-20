import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import path from "node:path";
import fs from "node:fs";

export type WorkerStatus = 
  | "READY" 
  | "LOGIN_PAGE_OPENED" 
  | "LOGIN_STATUS" 
  | "PROBE_COMPLETE" 
  | "PROBE_ERROR" 
  | "ERROR"
  | "MANUAL_REQUIRED"
  | "TIMEOUT";

export interface WorkerMessage {
  type: WorkerStatus | "SHUTDOWN";
  platform?: string;
  status?: string;
  answer?: string;
  message?: string;
}

export interface SessionConfig {
  accountId: string;
  platform: string;
  profileBasePath?: string;
}

export class ProbeWorkerClient {
  private process: ReturnType<typeof spawn> | null = null;
  private resolvers: Map<string, (value: unknown) => void> = new Map();
  private rejecters: Map<string, (reason: Error) => void> = new Map();
  private initialized = false;
  private sessionConfig: SessionConfig | null = null;
  private defaultTimeout = 120000;

  async init(config?: SessionConfig): Promise<void> {
    this.sessionConfig = config ?? null;
    
    return new Promise((resolve, reject) => {
      const env = { ...process.env };
      
      if (config) {
        env.PROBE_ACCOUNT_ID = config.accountId;
        env.PROBE_PLATFORM = config.platform;
        
        const profilePath = config.profileBasePath 
          ? path.join(config.profileBasePath, config.accountId, config.platform)
          : path.join(process.cwd(), "runtime", "browser-profiles", config.accountId, config.platform);
        
        env.PROBE_PROFILE_PATH = profilePath;
        
        try {
          fs.mkdirSync(profilePath, { recursive: true });
        } catch {}
      }

      this.process = spawn("node", ["scripts/domestic-probe-worker.mjs"], {
        stdio: ["pipe", "pipe", "inherit"],
        env,
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

  async send(cmd: Record<string, unknown>, timeoutMs?: number): Promise<WorkerMessage> {
    return new Promise((resolve, reject) => {
      if (!this.process) throw new Error("Worker not initialized");
      
      const type = cmd.type as string;
      this.resolvers.set(type, resolve as (value: unknown) => void);
      this.rejecters.set(type, reject);
      
      this.process.stdin!.write(JSON.stringify(cmd) + "\n");
      
      const timeout = timeoutMs ?? this.defaultTimeout;
      setTimeout(() => {
        if (this.resolvers.has(type)) {
          this.resolvers.delete(type);
          this.rejecters.delete(type);
          reject(new Error(`Command ${type} timeout after ${timeout}ms`));
        }
      }, timeout);
    });
  }

  async shutdown(): Promise<void> {
    if (!this.process) return;
    try {
      await this.send({ type: "SHUTDOWN" }, 5000);
    } catch {}
    try {
      this.process.kill("SIGTERM");
    } catch {}
    this.process = null;
    this.initialized = false;
  }

  getProfilePath(): string | null {
    if (!this.sessionConfig) return null;
    const { accountId, platform } = this.sessionConfig;
    const profileBasePath = this.sessionConfig.profileBasePath 
      ?? path.join(process.cwd(), "runtime", "browser-profiles");
    return path.join(profileBasePath, accountId, platform);
  }
}
