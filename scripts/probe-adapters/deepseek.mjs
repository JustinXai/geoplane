import { sleep } from "../utils.mjs";

export class DeepSeekAdapter {
  constructor(browser, contextOptions = {}) {
    this.browser = browser;
    this.context = null;
    this.page = null;
    this.contextOptions = contextOptions;
    this.loginUrl = "https://chat.deepseek.com/";
    this.defaultTimeout = 30000;
  }

  async ensurePage() {
    if (!this.page || this.page.isClosed()) {
      this.context = await this.browser.newContext(this.contextOptions);
      this.page = await this.context.newPage();
      await this.page.setViewportSize({ width: 1280, height: 900 });
      
      await this.page.route("**/*", async (route) => {
        const url = route.request().url();
        if (url.includes("captcha") || url.includes("verify") || url.includes("challenge")) {
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
      'textarea[placeholder*="输入"]',
      "textarea",
      'div[contenteditable="true"]',
    ];
    
    for (const sel of inputSelectors) {
      try {
        await page.waitForSelector(sel, { timeout: 3000 });
        return true;
      } catch {}
    }
    return false;
  }

  async isLoginRequired() {
    const page = await this.ensurePage();
    const loginSelectors = [
      'button:has-text("登录")',
      'a:has-text("登录")',
      'button:has-text("Sign in")',
      'a:has-text("Sign in")',
      '[data-testid="sign-in"]',
    ];
    
    for (const sel of loginSelectors) {
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
      'div:has-text("Captcha")',
      'iframe[src*="captcha"]',
      'div[class*="captcha"]',
      'div[class*="challenge"]',
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
      'a[href="/chat"]',
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
      await page.goto(this.loginUrl, { waitUntil: "networkidle" });
      await sleep(1000);
    } catch {}
  }

  async submitQuestion(question) {
    const page = await this.ensurePage();
    
    if (await this.isManualRequired()) {
      throw new Error("Manual verification required (captcha/scan)");
    }
    
    const inputSelectors = [
      'textarea[placeholder*="输入"]',
      "textarea",
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
    await page.keyboard.press("Enter");
  }

  async waitForAnswer({ maxWaitMs = 120000 } = {}) {
    const page = await this.ensurePage();
    const start = Date.now();
    let lastAnswer = "";
    let stableCount = 0;
    
    while (Date.now() - start < maxWaitMs) {
      await sleep(2000);
      
      if (await this.isManualRequired()) {
        throw new Error("Manual verification triggered during probe");
      }
      
      const answerSelectors = [
        '.ds-message-content p',
        '.message-assistant p',
        '[data-role="assistant"] p',
        '.markdown-body p',
        'main p',
        '.prose p',
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
        lastAnswer = currentAnswer;
        stableCount = 0;
      } else if (currentAnswer === lastAnswer && currentAnswer.length > 0) {
        stableCount++;
        if (stableCount >= 3) break;
      }
      
      try {
        const regen = await page.$('button:has-text("重新生成")');
        if (regen && lastAnswer.length > 0) break;
        
        const stopBtn = await page.$('button:has-text("停止")');
        if (!stopBtn && lastAnswer.length > 0) break;
      } catch {}
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
