export async function ensureContentScriptInjected(tabId: number) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"]
  });
}
