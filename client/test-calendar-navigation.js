// Calendar Navigation Test Script
// This script tests the calendar navigation functionality

const testCalendarNavigation = () => {
    console.log('=== Calendar Navigation Test ===');
    
    // Test 1: Check if calendar is loaded
    const calendarElement = document.querySelector('.rbc-calendar');
    if (calendarElement) {
        console.log('✅ Calendar component found');
    } else {
        console.log('❌ Calendar component not found');
        return;
    }
    
    // Test 2: Check if navigation buttons exist
    const toolbar = document.querySelector('.rbc-toolbar');
    const backButton = document.querySelector('.rbc-toolbar button:nth-child(2)');
    const nextButton = document.querySelector('.rbc-toolbar button:nth-child(3)');
    const todayButton = document.querySelector('.rbc-toolbar button:nth-child(1)');
    
    if (toolbar) {
        console.log('✅ Toolbar found');
    } else {
        console.log('❌ Toolbar not found');
    }
    
    if (backButton) {
        console.log('✅ Back button found');
    } else {
        console.log('❌ Back button not found');
    }
    
    if (nextButton) {
        console.log('✅ Next button found');
    } else {
        console.log('❌ Next button not found');
    }
    
    if (todayButton) {
        console.log('✅ Today button found');
    } else {
        console.log('❌ Today button not found');
    }
    
    // Test 3: Check current month display
    const monthLabel = document.querySelector('.rbc-toolbar-label');
    if (monthLabel) {
        console.log('✅ Month label found:', monthLabel.textContent);
    } else {
        console.log('❌ Month label not found');
    }
    
    // Test 4: Simulate navigation clicks
    let testResults = [];
    
    if (backButton) {
        console.log('🔄 Testing Back button...');
        backButton.click();
        setTimeout(() => {
            const newLabel = document.querySelector('.rbc-toolbar-label');
            if (newLabel) {
                console.log('✅ Back navigation result:', newLabel.textContent);
                testResults.push({ button: 'Back', result: 'Success', label: newLabel.textContent });
            } else {
                console.log('❌ Back navigation failed');
                testResults.push({ button: 'Back', result: 'Failed' });
            }
        }, 1000);
    }
    
    setTimeout(() => {
        if (nextButton) {
            console.log('🔄 Testing Next button...');
            nextButton.click();
            setTimeout(() => {
                const newLabel = document.querySelector('.rbc-toolbar-label');
                if (newLabel) {
                    console.log('✅ Next navigation result:', newLabel.textContent);
                    testResults.push({ button: 'Next', result: 'Success', label: newLabel.textContent });
                } else {
                    console.log('❌ Next navigation failed');
                    testResults.push({ button: 'Next', result: 'Failed' });
                }
            }, 1000);
        }
    }, 2000);
    
    setTimeout(() => {
        if (todayButton) {
            console.log('🔄 Testing Today button...');
            todayButton.click();
            setTimeout(() => {
                const newLabel = document.querySelector('.rbc-toolbar-label');
                if (newLabel) {
                    console.log('✅ Today navigation result:', newLabel.textContent);
                    testResults.push({ button: 'Today', result: 'Success', label: newLabel.textContent });
                } else {
                    console.log('❌ Today navigation failed');
                    testResults.push({ button: 'Today', result: 'Failed' });
                }
                
                // Final test results
                setTimeout(() => {
                    console.log('=== Test Results Summary ===');
                    testResults.forEach(result => {
                        console.log(`${result.button}: ${result.result} ${result.label ? '(' + result.label + ')' : ''}`);
                    });
                    
                    const successCount = testResults.filter(r => r.result === 'Success').length;
                    const totalCount = testResults.length;
                    
                    console.log(`=== Final Score: ${successCount}/${totalCount} tests passed ===`);
                    
                    if (successCount === totalCount) {
                        console.log('🎉 All navigation tests passed!');
                    } else {
                        console.log('⚠️  Some navigation tests failed. Check the implementation.');
                    }
                }, 1000);
            }, 1000);
        }
    }, 4000);
};

// Run the test after page loads
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', testCalendarNavigation);
} else {
    testCalendarNavigation();
}

// Also make it available globally for manual testing
window.testCalendarNavigation = testCalendarNavigation;

console.log('Calendar navigation test script loaded. You can also run testCalendarNavigation() manually.');
