// Test quiz creation and access without database connection
const testQuestions = [
  {
    id: 1,
    question: "What is the capital of France?",
    type: "multiple_choice",
    options: ["London", "Berlin", "Paris", "Madrid"],
    correct_answer: "Paris",
    points: 1,
    explanation: "Paris is the capital city of France"
  },
  {
    id: 2,
    question: "The Earth is round",
    type: "true_false", 
    options: [],
    correct_answer: "true",
    points: 1,
    explanation: "The Earth is approximately spherical"
  }
];

console.log('🧪 Testing Quiz Question Structure...\n');

// Test JSON serialization/deserialization
console.log('1️⃣ Original questions:');
console.log(JSON.stringify(testQuestions, null, 2));

const jsonString = JSON.stringify(testQuestions);
console.log('\n2️⃣ JSON string length:', jsonString.length);

try {
  const parsed = JSON.parse(jsonString);
  console.log('\n3️⃣ Parsed questions count:', parsed.length);
  console.log('✅ JSON serialization/parsing works correctly');
  
  // Test the same parsing logic used in the route
  if (typeof jsonString === 'string') {
    const reparsed = JSON.parse(jsonString);
    console.log('✅ Route-style parsing works');
  } else if (Array.isArray(jsonString)) {
    console.log('✅ Already an array');
  }
  
} catch (error) {
  console.log('❌ JSON parsing failed:', error.message);
}

console.log('\n4️⃣ Testing grade name formatting...');
const testGrades = [
  "Grade 1",
  "Grade Grade 1", 
  "1st Grade",
  "First Grade"
];

testGrades.forEach(gradeName => {
  const hasDoubleGrade = gradeName.toLowerCase().includes('grade grade');
  const fixed = gradeName.replace(/^grade\s+/i, '');
  console.log(`"${gradeName}" -> ${hasDoubleGrade ? 'NEEDS FIX' : 'OK'} -> "${fixed}"`);
});

console.log('\n🎉 Local tests completed!');
