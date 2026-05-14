import { chromium } from 'playwright';

async function runTests() {
  console.log('\n' + '='.repeat(60));
  console.log('🚀 AGENT CANVAS - AUTOMATED TEST SUITE');
  console.log('='.repeat(60) + '\n');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Collect console messages
  const logs = [];
  page.on('console', msg => {
    const text = msg.text();
    logs.push(text);
    console.log(text);
  });

  page.on('pageerror', err => {
    console.error('Page error:', err.message);
  });

  try {
    console.log('📡 Connecting to http://localhost:5174...\n');
    await page.goto('http://localhost:5174', { waitUntil: 'networkidle' });
    
    // Wait for test utilities to load
    await page.waitForFunction(() => 
      typeof window.testBackend === 'function' && 
      typeof window.testFrontend === 'function',
      { timeout: 10000 }
    );
    
    console.log('✅ Test utilities loaded\n');
    console.log('='.repeat(60));
    console.log('📦 BACKEND TESTS');
    console.log('='.repeat(60) + '\n');

    // Run backend tests
    const backendResults = await page.evaluate(async () => {
      return await window.testBackend();
    });

    console.log('\n' + '='.repeat(60));
    console.log('📦 FRONTEND TESTS');
    console.log('='.repeat(60) + '\n');

    // Run frontend tests
    const frontendResults = await page.evaluate(async () => {
      return await window.testFrontend();
    });

    // Summary
    const allResults = [...backendResults, ...frontendResults];
    const passed = allResults.filter(r => r.passed).length;
    const failed = allResults.filter(r => !r.passed).length;

    console.log('\n' + '='.repeat(60));
    console.log('📊 FINAL SUMMARY');
    console.log('='.repeat(60));
    console.log(`\nTotal Tests: ${allResults.length}`);
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);

    if (failed === 0) {
      console.log('\n🎉 ALL TESTS PASSED! 🎉\n');
    } else {
      console.log('\n❌ Failed tests:\n');
      allResults.filter(r => !r.passed).forEach(r => {
        console.log(`  • ${r.name}: ${r.error}`);
      });
      console.log('');
    }
    console.log('='.repeat(60) + '\n');

    await browser.close();
    process.exit(failed > 0 ? 1 : 0);

  } catch (error) {
    console.error('\n❌ Test runner error:', error.message);
    await browser.close();
    process.exit(1);
  }
}

runTests();
