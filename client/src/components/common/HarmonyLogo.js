import React from 'react';

const HarmonyLogo = ({ size = 40, className = "", showText = true, theme = "primary" }) => {
  const themes = {
    primary: {
      primary: "#e67700",    // Sunburst orange from school buildings
      secondary: "#233a78",  // Signage blue from school
      accent: "#ffffff",     // White
      gold: "#ffd166"        // Golden yellow from gate
    },
    white: {
      primary: "#ffffff",
      secondary: "#fff3e0",  // Light orange
      accent: "#f5f5f5",     // Off-white
      gold: "#ffd166"        // Golden yellow
    },
    dark: {
      primary: "#ff9800",    // Brighter orange for dark mode
      secondary: "#3f51b5",  // Brighter blue for dark mode
      accent: "#263238",     // Dark background
      gold: "#ffd166"        // Bright gold
    }
  };
  
  const colors = themes[theme] || themes.primary;
  
  return (
    <div className={`inline-flex items-center gap-3 ${className}`}>
      {/* Enhanced Logo SVG */}
      <div className="relative" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox="0 0 120 120"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="drop-shadow-lg"
        >
          {/* Background Circle with Gradient */}
          <defs>
            <linearGradient id="bgGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={colors.primary} />
              <stop offset="50%" stopColor={colors.accent} />
              <stop offset="100%" stopColor={colors.secondary} />
            </linearGradient>
            <linearGradient id="bookGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="100%" stopColor="#f8fafc" />
            </linearGradient>
            <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="2" dy="4" stdDeviation="3" floodColor="rgba(0,0,0,0.2)"/>
            </filter>
          </defs>
          
          {/* Main Circle Background - Clean white */}
          <circle
            cx="60"
            cy="60"
            r="55"
            fill="#ffffff"
            stroke="#e0e0e0"
            strokeWidth="1"
          />
          
          {/* Open Book - Orange matching school */}
          <path
            d="M25 45 L95 45 L95 75 L25 75 Z"
            fill={colors.primary}
            rx="3"
          />
          
          {/* Book Pages - White */}
          <path
            d="M25 45 L60 45 L60 75 L25 75 Z"
            fill="#ffffff"
            stroke={colors.primary}
            strokeWidth="2"
          />
          
          <path
            d="M60 45 L95 45 L95 75 L60 75 Z"
            fill="#ffffff"
            stroke={colors.primary}
            strokeWidth="2"
          />
          
          {/* Book Spine/Binding - Orange */}
          <line
            x1="60"
            y1="45"
            x2="60"
            y2="75"
            stroke={colors.primary}
            strokeWidth="3"
          />
          
          {/* Open Book Curve - Orange */}
          <path
            d="M25 45 Q42.5 35 60 45"
            fill="none"
            stroke={colors.primary}
            strokeWidth="2"
          />
          
          <path
            d="M60 45 Q77.5 35 95 45"
            fill="none"
            stroke={colors.primary}
            strokeWidth="2"
          />
          
          {/* Graduate Figure Head - Blue */}
          <circle
            cx="60"
            cy="25"
            r="8"
            fill={colors.secondary}
          />
          
          {/* Graduate Body - Blue */}
          <path
            d="M52 33 Q60 40 68 33 L68 42 L52 42 Z"
            fill={colors.secondary}
          />
          
          {/* Ribbon Banner - Orange */}
          <path
            d="M30 80 L90 80 L85 88 L35 88 Z"
            fill={colors.primary}
          />
          
          {/* Stars - Golden Yellow matching logo */}
          <g fill={colors.gold}>
            <circle cx="35" cy="95" r="1.5" />
            <circle cx="42" cy="97" r="1" />
            <circle cx="48" cy="95" r="1.5" />
            <circle cx="55" cy="97" r="1" />
            <circle cx="65" cy="97" r="1" />
            <circle cx="72" cy="95" r="1.5" />
            <circle cx="78" cy="97" r="1" />
            <circle cx="85" cy="95" r="1.5" />
          </g>
        </svg>
      </div>
      
      {/* School Name and Motto */}
      {showText && (
        <div className="flex flex-col">
          <h1 className="font-brand text-lg font-bold text-orange-600 leading-tight uppercase tracking-wide">
            Harmony
          </h1>
          <p className="font-display text-sm text-gray-800 font-semibold tracking-widest uppercase">
            Learning Institute
          </p>
          <p className="font-display text-xs text-blue-800 italic leading-tight mt-1">
            "Excellence in Education"
          </p>
        </div>
      )}
    </div>
  );
};

export default HarmonyLogo;
