import { useState, useEffect } from 'react';

// Custom hook for responsive design
export const useResponsive = () => {
  const [screenSize, setScreenSize] = useState({
    isMobile: false,
    isTablet: false,
    isDesktop: false,
    width: 0,
    height: 0
  });

  useEffect(() => {
    const updateScreenSize = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      
      setScreenSize({
        isMobile: width < 768,
        isTablet: width >= 768 && width < 1024,
        isDesktop: width >= 1024,
        width,
        height
      });
    };

    // Set initial size
    updateScreenSize();

    // Add event listener
    window.addEventListener('resize', updateScreenSize);
    window.addEventListener('orientationchange', updateScreenSize);

    // Cleanup
    return () => {
      window.removeEventListener('resize', updateScreenSize);
      window.removeEventListener('orientationchange', updateScreenSize);
    };
  }, []);

  return screenSize;
};

// Hook for touch device detection
export const useTouchDevice = () => {
  const [isTouch, setIsTouch] = useState(false);

  useEffect(() => {
    const checkTouch = () => {
      setIsTouch(
        'ontouchstart' in window ||
        navigator.maxTouchPoints > 0 ||
        navigator.msMaxTouchPoints > 0
      );
    };

    checkTouch();
  }, []);

  return isTouch;
};

// Hook for iOS device detection
export const useIOSDevice = () => {
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    const checkIOS = () => {
      setIsIOS(
        /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
      );
    };

    checkIOS();
  }, []);

  return isIOS;
};

// Hook for device orientation
export const useOrientation = () => {
  const [orientation, setOrientation] = useState('portrait');

  useEffect(() => {
    const updateOrientation = () => {
      if (window.innerHeight > window.innerWidth) {
        setOrientation('portrait');
      } else {
        setOrientation('landscape');
      }
    };

    updateOrientation();
    window.addEventListener('resize', updateOrientation);
    window.addEventListener('orientationchange', updateOrientation);

    return () => {
      window.removeEventListener('resize', updateOrientation);
      window.removeEventListener('orientationchange', updateOrientation);
    };
  }, []);

  return orientation;
};

// Hook for safe area insets (for devices with notches)
export const useSafeArea = () => {
  const [safeArea, setSafeArea] = useState({
    top: 0,
    right: 0,
    bottom: 0,
    left: 0
  });

  useEffect(() => {
    const updateSafeArea = () => {
      const computedStyle = getComputedStyle(document.documentElement);
      
      setSafeArea({
        top: parseInt(computedStyle.getPropertyValue('--sat') || '0'),
        right: parseInt(computedStyle.getPropertyValue('--sar') || '0'),
        bottom: parseInt(computedStyle.getPropertyValue('--sab') || '0'),
        left: parseInt(computedStyle.getPropertyValue('--sal') || '0')
      });
    };

    updateSafeArea();
    window.addEventListener('resize', updateSafeArea);
    window.addEventListener('orientationchange', updateSafeArea);

    return () => {
      window.removeEventListener('resize', updateSafeArea);
      window.removeEventListener('orientationchange', updateSafeArea);
    };
  }, []);

  return safeArea;
};

// Utility functions for responsive design
export const getResponsiveValue = (mobile, tablet, desktop, currentScreenSize) => {
  if (currentScreenSize.isMobile) return mobile;
  if (currentScreenSize.isTablet) return tablet;
  return desktop;
};

export const getResponsiveClasses = (baseClasses, mobileClasses = '', tabletClasses = '', desktopClasses = '') => {
  return `${baseClasses} ${mobileClasses} ${tabletClasses} ${desktopClasses}`;
};

// Helper function to get optimal touch target size
export const getTouchTargetSize = (isTouch, size = 'medium') => {
  if (!isTouch) return '';
  
  const sizes = {
    small: 'min-h-10 min-w-10',
    medium: 'min-h-12 min-w-12',
    large: 'min-h-14 min-w-14'
  };
  
  return sizes[size] || sizes.medium;
};

// Helper function for mobile-friendly spacing
export const getMobileSpacing = (isMobile, spacing = 'medium') => {
  if (!isMobile) return '';
  
  const spacings = {
    small: 'p-2 m-1',
    medium: 'p-4 m-2',
    large: 'p-6 m-4'
  };
  
  return spacings[spacing] || spacings.medium;
};
