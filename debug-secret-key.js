// Debug secret key format
const secretKey = 'abkQWjZUhC6EYU7+rX90cVLRF6/58GysfxE9tH48';

console.log('🔍 SECRET KEY ANALYSIS');
console.log('======================\n');

console.log(`Length: ${secretKey.length} characters`);
console.log(`First 10 chars: ${secretKey.substring(0, 10)}`);
console.log(`Last 10 chars: ${secretKey.substring(secretKey.length - 10)}`);
console.log(`Contains special chars: ${/[+/=]/.test(secretKey)}`);

// Check each character
console.log('\nCharacter analysis:');
for (let i = 0; i < secretKey.length; i++) {
  const char = secretKey[i];
  const code = char.charCodeAt(0);
  if (code < 32 || code > 126) {
    console.log(`⚠️  Invalid character at position ${i}: code ${code}`);
  }
}

// Test trimming
const trimmed = secretKey.trim();
console.log(`\nOriginal length: ${secretKey.length}`);
console.log(`Trimmed length: ${trimmed.length}`);
console.log(`Equal after trim: ${secretKey === trimmed}`);

// AWS secret keys should be 40 characters
console.log(`\nExpected length: 40 characters`);
console.log(`Actual length: ${secretKey.length} characters`);
console.log(`Length check: ${secretKey.length === 40 ? '✅ CORRECT' : '❌ INCORRECT'}`);

console.log('\nFull secret key (for verification):');
console.log(`"${secretKey}"`);
