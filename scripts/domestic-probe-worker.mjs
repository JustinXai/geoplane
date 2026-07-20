import { chromium } from "playwright";
import { DoubaoAdapter } from "./probe-adapters/doubao.mjs";
import { DeepSeekAdapter } from "./probe-adapters/deepseek.mjs";
import path from "node:path";
import fs from "node:fs";

const ADAPTERS = {
  DOUBAO: DoubaoAdapter,
  DEEPSEEK: DeepSeekAdapter,
};

let browser = null;
let adapter = null;

async function getBrowserOptions() {
  const profilePath = process.env.PROBE_PROFILE_PATH;
  const accountId = process.env.PROBE_ACCOUNT_ID;
  const platform = process.env.PROBE_PLATFORM;
  
  const options = {
    headless: false,
    args: ["--start-maximized", "--disable-blink-features=AutomationControlled"],
  };
  
  if (profilePath && accountId && platform) {
    options.userDataDir = profilePath;
  }
  
  return options;
}

async function handleCommand(cmd) {
  switch (cmd.type) {
    case "INIT": {
      const options = await getBrowserOptions();
      browser = await chromium.launch(options);
      process.stdout.write(JSON.stringify({ type: "READY" }) + "\n");
      break;
    }

    case "CONNECT":
      try {
        const PlatformAdapter = ADAPTERS[cmd.platform];
        if (!PlatformAdapter) throw new Error(`Unknown platform: ${cmd.platform}`);
        
        const profilePath = process.env.PROBE_PROFILE_PATH;
        const contextOptions = profilePath ? { userDataDir: profilePath } : {};
        
        adapter = new PlatformAdapter(browser, contextOptions);
        await adapter.openLoginPage();
        process.stdout.write(JSON.stringify({ type: "LOGIN_PAGE_OPENED", platform: cmd.platform }) + "\n");
      } catch (err) {
        process.stdout.write(JSON.stringify({ type: "ERROR", message: err.message }) + "\n");
      }
      break;

    case "CHECK_LOGIN":
      try {
        const status = await adapter.checkLoginState();
        process.stdout.write(JSON.stringify({ type: "LOGIN_STATUS", status }) + "\n");
      } catch (err) {
        process.stdout.write(JSON.stringify({ type: "ERROR", message: err.message }) + "\n");
      }
      break;

    case "PROBE":
      try {
        await adapter.startNewConversation();
        await adapter.submitQuestion(cmd.question);
        const answer = await adapter.waitForAnswer({ maxWaitMs: cmd.maxWaitMs ?? 120000 });
        process.stdout.write(JSON.stringify({ type: "PROBE_COMPLETE", answer }) + "\n");
      } catch (err) {
        const errorType = err.message.includes("timeout") ? "TIMEOUT" : "PROBE_ERROR";
        process.stdout.write(JSON.stringify({ type: errorType, message: err.message }) + "\n");
      }
      break;

    case "SHUTDOWN":
      if (browser) await browser.close();
      process.exit(0);
      break;
  }
}

process.stdin.setEncoding("utf8");
for await (const line of process.stdin) {
  try {
    const cmd = JSON.parse(line.trim());
    await handleCommand(cmd);
  } catch (e) {
    process.stdout.write(JSON.stringify({ type: "ERROR", message: `Parse error: ${e.message}` }) + "\n");
  }
}
