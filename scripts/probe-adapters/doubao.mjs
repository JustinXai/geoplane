import { waitFor } from "../utils.mjs";

export class DoubaoAdapter {
  constructor(browser) {
    this.browser = browser;
    this.context = null;
    this.page = null;
    this.loginUrl = "https://www.doubao.com/chat/";
    this.chatUrl = "https://www.doubao.com/chat/";
  }

  async ensurePage() {
    if (!this.page || this.page.isClosed()) {
      this.context = await this.browser.newContext();
      this.page = await this.context.newPage();
      await this.page.setViewportSize({ width: 1280, height: 900 });
    }
    return this.page;
  }

  async openLoginPage() {
    const page = await this.ensurePage();
    await page.goto(this.loginUrl, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(2000);
    return page;
  }

  async checkLoginState() {
    const page = await this.ensurePage();
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    
    // Check for input box - means logged in
    const inputSelectors = [
      "textarea",
      'div[role="textbox"]',
      '[contenteditable="true"]',
      "input[type='text']",
    ];
    
    for (const sel of inputSelectors) {
      try {
        const el = await page.waitForSelector(sel, { timeout: 3000 });
        if (el) return "READY";
      } catch {}
    }
    
    // Check for login button - means not logged in
    const loginButtonSelectors = [
      'button:has-text("登录")',
      'a:has-text("登录")',
      '[data-testid="login-btn"]',
    ];
    
    for (const sel of loginButtonSelectors) {
      try {
        await page.waitForSelector(sel, { timeout: 2000 });
        return "WAITING_FOR_LOGIN";
      } catch {}
    }
    
    return "MANUAL_REQUIRED";
  }

  async startNewConversation() {
    const page = await this.ensurePage();
    // Look for new chat button
    const newChatSelectors = [
      'button:has-text("新对话")',
      'button:has-text("New Chat")',
      '[data-testid="new-chat"]',
      'a[href="/chat/"]',
    ];
    
    for (const sel of newChatSelectors) {
      try {
        await page.waitForSelector(sel, { timeout: 3000 });
        await page.click(sel);
        await page.waitForTimeout(1000);
        return;
      } catch {}
    }
  }

  async submitQuestion(question) {
    const page = await this.ensurePage();
    // Wait for input
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
    await page.waitForTimeout(300);
    
    // Submit with Enter or send button
    try {
      await page.keyboard.press("Enter");
    } catch {}
    
    // Also try send button
    const sendSelectors = [
      'button[data-testid*="send"]',
      'button[aria-label*="send"]',
      'button[type="submit"]',
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
      await page.waitForTimeout(2000);
      
      // Try to find the latest assistant message
      const answerSelectors = [
        // Doubao specific
        '.chat-message-assistant p',
        '.message-assistant p',
        '[data-message-role="assistant"] p',
        '.MarkdownBody p',
        // Fallback
        '.chat-content p',
        'main p',
      ];
      
      let currentAnswer = "";
      for (const sel of answerSelectors) {
        try {
          const els = await page.$$(sel);
          if (els.length > 0) {
            const lastEl = els[els.length - 1];
            currentAnswer = await lastEl.innerText();
            break;
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
      
      // Check if thinking/generating indicator is gone
      try {
        const stopIndicators = [
          'button:has-text("重新生成")',
          'button:has-text("停止")',
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
      } catch {}
    }
    
    if (!lastAnswer) throw new Error("No answer received");
    return lastAnswer;
  }
}
