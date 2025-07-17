// Check authentication status
const checkAuth = () => {
  const token = localStorage.getItem('token');
  console.log('🔐 Auth Check:', {
    hasToken: !!token,
    tokenLength: token ? token.length : 0,
    tokenStart: token ? token.substring(0, 20) + '...' : 'No token'
  });
  
  // Try to decode JWT payload (simple check)
  if (token) {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      console.log('👤 Token Payload:', payload);
      console.log('⏰ Token Expiry:', new Date(payload.exp * 1000));
      console.log('🕐 Current Time:', new Date());
      console.log('✅ Token Valid:', payload.exp * 1000 > Date.now());
    } catch (e) {
      console.error('❌ Invalid token format:', e);
    }
  }
};

checkAuth();
