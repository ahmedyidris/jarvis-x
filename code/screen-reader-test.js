/**
 * Screen reader test helper
 * Use with NVDA (Windows) or VoiceOver (Mac)
 * Logs all screen-reader-visible content
 */

class ScreenReaderTest {
  static audit() {
    console.log('=== SCREEN READER AUDIT ===');
    
    // Find all interactive elements
    const buttons = document.querySelectorAll('button');
    const inputs = document.querySelectorAll('input, textarea');
    const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
    
    console.log(`\n[Buttons: ${buttons.length}]`);
    buttons.forEach((btn, i) => {
      const label = btn.getAttribute('aria-label') || btn.textContent || '(no label)';
      console.log(`  ${i+1}. ${label}`);
    });
    
    console.log(`\n[Form inputs: ${inputs.length}]`);
    inputs.forEach((inp, i) => {
      const label = inp.getAttribute('aria-label') || inp.placeholder || inp.name || '(no label)';
      console.log(`  ${i+1}. ${label}`);
    });
    
    console.log(`\n[Headings: ${headings.length}]`);
    headings.forEach((h, i) => {
      console.log(`  ${h.tagName}: ${h.textContent}`);
    });

    // Check ARIA live regions
    const liveRegions = document.querySelectorAll('[aria-live]');
    console.log(`\n[Live regions (for screen readers): ${liveRegions.length}]`);
    liveRegions.forEach((r, i) => {
      console.log(`  ${i+1}. aria-live="${r.getAttribute('aria-live')}" — ${r.textContent.substring(0, 50)}`);
    });

    console.log('\n=== END AUDIT ===');
  }

  static simulateScreenReaderNav() {
    console.log('=== SIMULATING SCREEN READER NAVIGATION ===');
    const focusable = document.querySelectorAll('button, [href], input, [tabindex]');
    focusable.forEach((el, i) => {
      console.log(`${i+1}. ${el.tagName} — ${el.getAttribute('aria-label') || el.textContent || el.href}`);
    });
  }
}

if (typeof window !== 'undefined') {
  window.ScreenReaderTest = ScreenReaderTest;
}

module.exports = ScreenReaderTest;
