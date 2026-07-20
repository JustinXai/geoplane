import { waitFor, sleep } from "../utils.mjs";

export class DoubaoAdapter {
  constructor(browser, contextOptions = {}) {
    this.browser = browser;
    this.context = null;
    this.page = null;
    this.contextOptions = contextOptions;
    this.loginUrl = "https://www.doubao.com/chat/";
    this.chatUrl = "https://www.doubao.com/chat/";
    this.defaultTimeout = 30000;
  }

  async ensurePage() {
    if (!this.page || this.page.isClosed()) {
      this.context = await this.browser.newContext(this.contextOptions);
      this.page = await this.context.newPage();
      await this.page.setViewportSize({ width: 1280, height: 900 });
      
      await this.page.route("**/*", async (route) => {
        const url = route.request().url();
        if (url.includes("captcha") || url.includes("verify")) {
          await route.abort();
        } else {
          await route.continue();
        }
      });
    }
    return this.page;
  }

  async openLoginPage() {
    const page = await this.ensurePage();
    try {
      await page.goto(this.loginUrl, { waitUntil: "networkidle", timeout: 30000 });
      await sleep(2000);
      return page;
    } catch (err) {
      if (err.message.includes("net::ERR_")) {
        throw new Error(`Network error: ${err.message}. Check internet connection.`);
      }
      throw err;
    }
  }

  async checkLoginState() {
    const page = await this.ensurePage();
    try {
      await page.reload({ waitUntil: "networkidle" });
      await sleep(1500);
    } catch {}
    
    if (await this.isLoginRequired()) {
      return "WAITING_FOR_LOGIN";
    }
    
    if (await this.isManualRequired()) {
      return "MANUAL_REQUIRED";
    }
    
    if (await this.isLoggedIn()) {
      return "READY";
    }
    
    return "MANUAL_REQUIRED";
  }

  async isLoggedIn() {
    const page = await this.ensurePage();
    const inputSelectors = [
      "textarea",
      'div[role="textbox"]',
      '[contenteditable="true"]',
      "input[type='text']",
    ];
    
    for (const sel of inputSelectors) {
      try {
        const el = await page.waitForSelector(sel, { timeout: 3000 });
        if (el) return true;
      } catch {}
    }
    return false;
  }

  async isLoginRequired() {
    const page = await this.ensurePage();
    const loginButtonSelectors = [
      'button:has-text("登录")',
      'a:has-text("登录")',
      'button:has-text("login")',
      'a:has-text("login")',
      '[data-testid="login-btn"]',
    ];
    
    for (const sel of loginButtonSelectors) {
      try {
        await page.waitForSelector(sel, { timeout: 2000 });
        return true;
      } catch {}
    }
    return false;
  }

  async isManualRequired() {
    const page = await this.ensurePage();
    const manualIndicators = [
      'div:has-text("验证")',
      'div:has-text("扫码")',
      'div:has-text("captcha")',
      'iframe[src*="captcha"]',
      'div[class*="captcha"]',
      '[data-testid="challenge"]',
    ];
    
    for (const sel of manualIndicators) {
      try {
        await page.waitForSelector(sel, { timeout: 2000 });
        return true;
      } catch {}
    }
    return false;
  }

  async startNewConversation() {
    const page = await this.ensurePage();
    const newChatSelectors = [
      'button:has-text("新对话")',
      'button:has-text("New Chat")',
      '[data-testid="new-chat"]',
      'a[href="/chat/"]',
      'button:has-text("清空")',
    ];
    
    for (const sel of newChatSelectors) {
      try {
        await page.waitForSelector(sel, { timeout: 3000 });
        await page.click(sel);
        await sleep(1000);
        return;
      } catch {}
    }
    
    try {
      await page.goto(this.chatUrl, { waitUntil: "networkidle" });
      await sleep(1000);
    } catch {}
  }

  async submitQuestion(question) {
    const page = await this.ensurePage();
    
    if (await this.isManualRequired()) {
      throw new Error("Manual verification required (captcha/scan)");
    }
    
    const inputSelectors = [
      "textarea",
      'div[role="textbox"]',
      '[contenteditable="true"]',
    ];
    
    let inputEl = null;
    for (const sel of inputSelectors) {
      try {
        inputEl = await page.waitForSelector(sel, { timeout: 5000 });
        break;
      } catch {}
    }
    
    if (!inputEl) throw new Error("Input element not found");
    
    await inputEl.click();
    await inputEl.fill(question);
    await sleep(300);
    
    try {
      await page.keyboard.press("Enter");
    } catch {}
    
    const sendSelectors = [
      'button[data-testid*="send"]',
      'button[aria-label*="send"]',
      'button[type="submit"]',
      'button:has-text("发送")',
      'button:has-text("Send")',
    ];
    
    for (const sel of sendSelectors) {
      try {
        await page.waitForSelector(sel, { timeout: 2000 });
        await page.click(sel);
        break;
      } catch {}
    }
  }

  async waitForAnswer({ maxWaitMs = 120000 } = {}) {
    const page = await this.ensurePage();
    const start = Date.now();
    let lastAnswer = "";
    let stableCount = 0;
    const lastAnswers = [];
    
    while (Date.now() - start < maxWaitMs) {
      await sleep(2000);
      
      if (await this.isManualRequired()) {
        throw new Error("Manual verification triggered during probe");
      }
      
      const answerSelectors = [
        '.chat-message-assistant p',
        '.message-assistant p',
        '[data-message-role="assistant"] p',
        '.MarkdownBody p',
        '.chat-content p',
        'main p',
        '.douyin-gateway p',
      ];
      
      let currentAnswer = "";
      for (const sel of answerSelectors) {
        try {
          const els = await page.$$(sel);
          if (els.length > 0) {
            const lastEl = els[els.length - 1];
            currentAnswer = await lastEl.innerText();
            if (currentAnswer.length > 10) break;
          }
        } catch {}
      }
      
      if (currentAnswer && currentAnswer !== lastAnswer) {
        lastAnswers.push(currentAnswer);
        lastAnswer = currentAnswer;
        stableCount = 0;
      } else if (currentAnswer === lastAnswer && currentAnswer.length > 0) {
        stableCount++;
        if (stableCount >= 3) break;
      }
      
      const stopIndicators = [
        'button:has-text("重新生成")',
        'button:has-text("停止")',
        'button:has-text("Stop")',
        '[data-testid="regenerate"]',
      ];
      
      let allGone = true;
      for (const sel of stopIndicators) {
        try {
          await page.waitForSelector(sel, { timeout: 500 });
          allGone = false;
        } catch {}
      }
      if (allGone && lastAnswer.length > 0) break;
    }
    
    if (!lastAnswer) {
      throw new Error(`No answer received within ${maxWaitMs}ms`);
    }
    return lastAnswer;
  }

  async cleanup() {
    if (this.context) {
      await this.context.close().catch(() => {});
      this.context = null;
      this.page = null;
    }
  }
}
