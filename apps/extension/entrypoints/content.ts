export default defineContentScript({
  matches: ['<all_urls>'], // This allows it to run on any website
  main() {
    // Listen for messages from the background script
    browser.runtime.onMessage.addListener((message) => {
      if (message.action === 'MNEMO_SAVED') {
        showToast();
      }
    });
  },
});

function showToast() {
  // 1. Create the UI element
  const toast = document.createElement('div');
  toast.innerText = '✨ Saved to Mnemo';
  
  // 2. Style it (Sleek, dark mode, floating in the bottom right)
  Object.assign(toast.style, {
    position: 'fixed',
    bottom: '20px',
    right: '20px',
    backgroundColor: '#121212',
    color: '#ffffff',
    padding: '12px 24px',
    borderRadius: '8px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
    fontFamily: 'sans-serif',
    fontSize: '14px',
    fontWeight: 'bold',
    zIndex: '999999',
    transition: 'opacity 0.3s ease-in-out',
    opacity: '0',
  });

  // 3. Put it on the screen
  document.body.appendChild(toast);

  // 4. Fade it in, wait 2 seconds, fade it out, and delete it
  setTimeout(() => (toast.style.opacity = '1'), 10);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 2000);
}