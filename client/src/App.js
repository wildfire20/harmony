import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import Announcements from './components/announcements/Announcements';
import './App.css';

function App() {
  return (
    <AuthProvider>
      <Router>
        <div className="App">
          <header className="App-header">
            <h1>Harmony Learning Institute</h1>
          </header>
          <main>
            <Routes>
              <Route path="/" element={<Announcements />} />
              <Route path="/announcements" element={<Announcements />} />
            </Routes>
          </main>
        </div>
      </Router>
    </AuthProvider>
  );
}

export default App;
