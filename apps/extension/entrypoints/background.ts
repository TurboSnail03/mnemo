export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => {
    browser.contextMenus.create({
      id: 'save-to-mnemo',
      title: 'Save to Mnemo',
      contexts: ['selection'],
    });
  });

  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === 'save-to-mnemo' && info.selectionText && tab?.id) {
      // We pass the tab.id down so we know where to send the success message
      saveHighlight(
        info.selectionText, 
        tab.title || 'Web Snippet', 
        tab.url || '',
        tab.id
      );
    }
  });

  async function saveHighlight(content: string, title: string, url: string, tabId: number) {
    try {
      const response = await fetch('http://127.0.0.1:8000/highlights/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: content,
          book_title: title,
          author: "Web Author", 
          url: url,
          tags: ["web-clip"],
        }),
      });

      if (response.ok) {
        console.log('Mnemo: Successfully saved highlight!');
        // Send the success message to the content script on that specific tab!
        browser.tabs.sendMessage(tabId, { action: 'MNEMO_SAVED' });
      }
    } catch (error) {
      console.error('Mnemo: Error connecting to API:', error);
    }
  }
});