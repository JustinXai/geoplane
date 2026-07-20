export async function waitFor(selector, options = {}) {
  const { timeout = 30000, state = "attached" } = options;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${selector}`)), timeout);
    
    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) {
        clearTimeout(timer);
        observer.disconnect();
        resolve(el);
      }
    });
    
    observer.observe(document.body, { childList: true, subtree: true });
    const existing = document.querySelector(selector);
    if (existing) {
      clearTimeout(timer);
      observer.disconnect();
      resolve(existing);
    }
  });
}

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
