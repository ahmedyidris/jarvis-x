/**
 * Keyboard navigation for Jarvis X
 * Arrow keys, Tab, Enter, Space, ?, Escape
 */

class KeyboardNav {
  constructor() {
    this.hotkeys = new Map();
    this.setupDefaultHotkeys();
  }

  setupDefaultHotkeys() {
    this.register('?', () => this.showHelp());
    this.register('Escape', () => this.close());
    this.register('Enter', (_e) => this.submit());
    this.register('Tab', (e) => this.focusNext(e));
    this.register('Shift+Tab', (e) => this.focusPrev(e));
  }

  register(key, handler) {
    this.hotkeys.set(key, handler);
  }

  /**
   * Attach to document
   */
  attach() {
    document.addEventListener('keydown', (e) => {
      const key = this.getKeyName(e);
      if (this.hotkeys.has(key)) {
        this.hotkeys.get(key)(e);
      }
    });
  }

  getKeyName(e) {
    let key = e.key;
    if (e.shiftKey) key = 'Shift+' + key;
    if (e.ctrlKey) key = 'Ctrl+' + key;
    if (e.metaKey) key = 'Meta+' + key;
    return key;
  }

  showHelp() {
    const help = `
Keyboard shortcuts:
Tab — Next field
Shift+Tab — Previous field
Enter — Submit query
Space — Activate button
Escape — Close dialog
? — This help
`;
    console.log(help);
    if (typeof window !== 'undefined') {
      alert(help);
    }
  }

  close() {
    console.log('[KeyboardNav] Closing...');
  }

  submit() {
    console.log('[KeyboardNav] Submitting...');
  }

  focusNext(_e) {
    const focusable = Array.from(document.querySelectorAll('button, [href], input, [tabindex]'));
    const current = document.activeElement;
    const idx = focusable.indexOf(current);
    if (idx < focusable.length - 1) {
      focusable[idx + 1].focus();
    }
  }

  focusPrev(_e) {
    const focusable = Array.from(document.querySelectorAll('button, [href], input, [tabindex]'));
    const current = document.activeElement;
    const idx = focusable.indexOf(current);
    if (idx > 0) {
      focusable[idx - 1].focus();
    }
  }
}

module.exports = KeyboardNav;
