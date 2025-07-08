// Calendar Navigation Test Results
// Run this script in the browser console on the calendar page

async function testCalendarNavigation() {
    console.log('🔍 Testing Calendar Navigation...');
    
    // Wait for calendar to load
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Test 1: Check if elements exist
    const toolbar = document.querySelector('.rbc-toolbar');
    const backBtn = document.querySelector('.rbc-toolbar button:contains("Back")') || 
                   document.querySelector('.rbc-toolbar button:nth-child(2)');
    const nextBtn = document.querySelector('.rbc-toolbar button:contains("Next")') || 
                   document.querySelector('.rbc-toolbar button:nth-child(3)');
    const todayBtn = document.querySelector('.rbc-toolbar button:contains("Today")') || 
                    document.querySelector('.rbc-toolbar button:nth-child(1)');
    const monthLabel = document.querySelector('.rbc-toolbar-label');
    
    console.log('📍 Element Check:');
    console.log('  Toolbar:', toolbar ? '✅' : '❌');
    console.log('  Back Button:', backBtn ? '✅' : '❌');
    console.log('  Next Button:', nextBtn ? '✅' : '❌');
    console.log('  Today Button:', todayBtn ? '✅' : '❌');
    console.log('  Month Label:', monthLabel ? '✅' : '❌');
    
    if (!toolbar || !backBtn || !nextBtn || !todayBtn || !monthLabel) {
        console.log('❌ Calendar elements not found. Test failed.');
        return;
    }
    
    // Test 2: Record initial state
    const initialMonth = monthLabel.textContent;
    console.log('📅 Initial month:', initialMonth);
    
    // Test 3: Test Back button
    console.log('🔄 Testing Back button...');
    backBtn.click();
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    const afterBackMonth = monthLabel.textContent;
    console.log('📅 After Back:', afterBackMonth);
    
    const backWorked = afterBackMonth !== initialMonth;
    console.log('  Back button:', backWorked ? '✅' : '❌');
    
    // Test 4: Test Next button
    console.log('🔄 Testing Next button...');
    nextBtn.click();
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    const afterNextMonth = monthLabel.textContent;
    console.log('📅 After Next:', afterNextMonth);
    
    const nextWorked = afterNextMonth !== afterBackMonth;
    console.log('  Next button:', nextWorked ? '✅' : '❌');
    
    // Test 5: Test Today button
    console.log('🔄 Testing Today button...');
    todayBtn.click();
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    const afterTodayMonth = monthLabel.textContent;
    console.log('📅 After Today:', afterTodayMonth);
    
    const todayWorked = afterTodayMonth.includes('2025'); // Should be current year
    console.log('  Today button:', todayWorked ? '✅' : '❌');
    
    // Test 6: Check for events loading
    const events = document.querySelectorAll('.rbc-event');
    console.log('📊 Events found:', events.length);
    
    // Summary
    const totalTests = 3;
    const passedTests = [backWorked, nextWorked, todayWorked].filter(Boolean).length;
    
    console.log('📝 Test Summary:');
    console.log(`  Passed: ${passedTests}/${totalTests} tests`);
    console.log(`  Success Rate: ${Math.round((passedTests/totalTests)*100)}%`);
    
    if (passedTests === totalTests) {
        console.log('🎉 All navigation tests passed!');
    } else {
        console.log('⚠️  Some tests failed. Check the implementation.');
    }
    
    // Network activity check
    const networkEntries = performance.getEntriesByType('resource');
    const calendarAPICalls = networkEntries.filter(entry => 
        entry.name.includes('/calendar') && entry.initiatorType === 'fetch'
    );
    
    console.log('🌐 Network Activity:');
    console.log(`  Calendar API calls: ${calendarAPICalls.length}`);
    
    return {
        elementsFound: toolbar && backBtn && nextBtn && todayBtn && monthLabel,
        backWorked,
        nextWorked,
        todayWorked,
        eventsCount: events.length,
        apiCalls: calendarAPICalls.length,
        passedTests,
        totalTests,
        successRate: Math.round((passedTests/totalTests)*100)
    };
}

// Run the test
testCalendarNavigation().then(results => {
    console.log('🏁 Test completed with results:', results);
}).catch(error => {
    console.error('❌ Test failed with error:', error);
});
