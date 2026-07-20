export class DeepSeekAdapter {
  constructor(browser) {
    this.browser = browser;
    this.context = null;
    this.page = null;
    this.loginUrl = "https://chat.deepseek.com/";
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
    
    const inputSelectors = [
      'textarea[placeholder*="输入"]',
      "textarea",
      'div[contenteditable="true"]',
    ];
    
    for (const sel of inputSelectors) {
      try {
        await page.waitForSelector(sel, { timeout: 3000 });
        return "READY";
      } catch {}
    }
    
    const loginSelectors = [
      'button:has-text("登录")',
      'a:has-text("登录")',
    ];
    
    for (const sel of loginSelectors) {
      try {
        await page.waitForSelector(sel, { timeout: 2000 });
        return "WAITING_FOR_LOGIN";
      } catch {}
    }
    
    return "MANUAL_REQUIRED";
  }

  async startNewConversation() {
    const page = await this.ensurePage();
    const newChatSelectors = [
      'button:has-text("新对话")',
      'button:has-text("New Chat")',
      'a[href="/chat"]',
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
    await page.waitForTimeout(300);
    await page.keyboard.press("Enter");
  }

  async waitForAnswer({ maxWaitMs = 120000 } = {}) {
    const page = await this.ensurePage();
    const start = Date.now();
    let lastAnswer = "";
    let stableCount = 0;
    
    while (Date.now() - start < maxWaitMs) {
      await page.waitForTimeout(2000);
      
      const answerSelectors = [
        '.ds-message-content p',
        '.message-assistant p',
        '[data-role="assistant"] p',
        '.markdown-body p',
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
        lastAnswer = currentAnswer;
        stableCount = 0;
      } else if (currentAnswer === lastAnswer && currentAnswer.length > 0) {
        stableCount++;
        if (stableCount >= 3) break;
      }
      
      // Check if done
      try {
        const regen = await page.$('button:has-text("重新生成")');
        if (regen && lastAnswer.length > 0) break;
      } catch {}
    }
    
    if (!lastAnswer) throw new Error("No answer received");
    return lastAnswer;
  }
}
