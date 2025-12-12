import React from 'react';

const HarmonyLogo = ({ size = 40, className = "", showText = true, theme = "primary" }) => {
  return (
    <div className={`inline-flex items-center gap-3 ${className}`}>
      <img 
        src="/images/harmony-logo.png" 
        alt="Harmony Learning Institute Logo"
        style={{ width: size, height: size }}
        className="object-contain"
      />
      
      {showText && (
        <div className="flex flex-col">
          <h1 className="font-brand text-lg font-bold text-red-600 leading-tight uppercase tracking-wide">
            Harmony Learning
          </h1>
          <p className="font-display text-sm text-blue-800 font-semibold tracking-widest uppercase">
            Institute
          </p>
        </div>
      )}
    </div>
  );
};

export default HarmonyLogo;
