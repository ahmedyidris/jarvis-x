/**
 * Accessibility utilities
 * ARIA labels, keyboard nav, screen reader helpers
 */

const A11Y = {
  // ARIA label builder
  label: (text) => ({ 'aria-label': text, role: 'button' }),
  
  // Keyboard handler (Enter/Space to submit, Escape to close)
  onKeyHandler: (handler) => {
    return (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handler();
      }
      if (e.key === 'Escape') {
        console.log('[A11Y] Escape pressed');
      }
    };
  },

  // Announce to screen readers
  announce: (message, priority = 'polite') => {
    const ariaLive = document.createElement('div');
    ariaLive.setAttribute('aria-live', priority);
    ariaLive.setAttribute('aria-atomic', 'true');
    ariaLive.textContent = message;
    document.body.appendChild(ariaLive);
    setTimeout(() => ariaLive.remove(), 3000);
  },

  // Caption display helper
  showCaption: (text, duration = 3000) => {
    const caption = document.createElement('div');
    caption.style.cssText = `
      position: fixed; bottom: 20px; left: 20px; right: 20px;
      background: #222; color: #fff; padding: 12px; border-radius: 4px;
      font-size: 14px; z-index: 9999;
      aria-live: polite;
    `;
    caption.textContent = text;
    caption.setAttribute('role', 'status');
    document.body.appendChild(caption);
    setTimeout(() => caption.remove(), duration);
  },

  // Keyboard help
  showKeyboardHelp: () => {
    const help = `
      Keyboard shortcuts:
      Tab — Navigate
      Enter — Submit
      Space — Activate button
      ? — This help
      Escape — Close dialog
    `;
    A11Y.announce(help, 'assertive');
  }
};

module.exports = A11Y;
