import React, { forwardRef } from 'react';
import { useResponsive, useTouchDevice } from '../../hooks/useResponsive';

// Mobile-optimized Button component
export const MobileButton = forwardRef(({ 
  children, 
  variant = 'primary', 
  size = 'medium', 
  fullWidth = false,
  disabled = false,
  className = '',
  ...props 
}, ref) => {
  const { isMobile } = useResponsive();
  const isTouch = useTouchDevice();

  const baseClasses = `
    inline-flex items-center justify-center font-medium rounded-lg
    transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2
    disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation
    ${isTouch ? 'active:scale-95' : 'hover:scale-105'}
    ${fullWidth ? 'w-full' : ''}
  `;

  const variants = {
    primary: 'bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500',
    secondary: 'bg-gray-200 text-gray-900 hover:bg-gray-300 focus:ring-gray-500',
    outline: 'border-2 border-blue-600 text-blue-600 hover:bg-blue-50 focus:ring-blue-500',
    ghost: 'text-gray-700 hover:bg-gray-100 focus:ring-gray-500'
  };

  const sizes = {
    small: isMobile ? 'px-4 py-3 text-sm min-h-12' : 'px-3 py-2 text-sm min-h-10',
    medium: isMobile ? 'px-6 py-4 text-base min-h-14' : 'px-4 py-2 text-base min-h-10',
    large: isMobile ? 'px-8 py-5 text-lg min-h-16' : 'px-6 py-3 text-lg min-h-12'
  };

  return (
    <button
      ref={ref}
      className={`${baseClasses} ${variants[variant]} ${sizes[size]} ${className}`}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  );
});

// Mobile-optimized Input component
export const MobileInput = forwardRef(({ 
  type = 'text', 
  placeholder = '',
  className = '',
  error = false,
  ...props 
}, ref) => {
  const { isMobile } = useResponsive();

  const baseClasses = `
    block w-full rounded-lg border border-gray-300 shadow-sm
    transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
    disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed
    ${error ? 'border-red-500 focus:ring-red-500' : ''}
    ${isMobile ? 'px-4 py-4 text-base min-h-14' : 'px-3 py-2 text-sm min-h-10'}
  `;

  return (
    <input
      ref={ref}
      type={type}
      placeholder={placeholder}
      className={`${baseClasses} ${className}`}
      style={{ fontSize: isMobile ? '16px' : '14px' }} // Prevent zoom on iOS
      {...props}
    />
  );
});

// Mobile-optimized Card component
export const MobileCard = ({ 
  children, 
  className = '', 
  padding = 'medium',
  shadow = true,
  ...props 
}) => {
  const { isMobile } = useResponsive();

  const paddings = {
    small: isMobile ? 'p-3' : 'p-2',
    medium: isMobile ? 'p-4' : 'p-4',
    large: isMobile ? 'p-6' : 'p-6'
  };

  const baseClasses = `
    bg-white rounded-lg border border-gray-200
    ${shadow ? 'shadow-sm hover:shadow-md' : ''}
    ${paddings[padding]}
    transition-shadow duration-200
  `;

  return (
    <div className={`${baseClasses} ${className}`} {...props}>
      {children}
    </div>
  );
};

// Mobile-optimized Select component
export const MobileSelect = forwardRef(({ 
  children, 
  className = '',
  error = false,
  ...props 
}, ref) => {
  const { isMobile } = useResponsive();

  const baseClasses = `
    block w-full rounded-lg border border-gray-300 bg-white shadow-sm
    transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
    disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed
    appearance-none bg-no-repeat bg-right
    ${error ? 'border-red-500 focus:ring-red-500' : ''}
    ${isMobile ? 'px-4 py-4 text-base min-h-14' : 'px-3 py-2 text-sm min-h-10'}
  `;

  const arrowIcon = `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='m6 8 4 4 4-4'/%3e%3c/svg%3e")`;

  return (
    <select
      ref={ref}
      className={`${baseClasses} ${className}`}
      style={{ 
        backgroundImage: arrowIcon,
        backgroundPosition: 'right 12px center',
        backgroundSize: '16px',
        fontSize: isMobile ? '16px' : '14px'
      }}
      {...props}
    >
      {children}
    </select>
  );
});

// Mobile-optimized Modal component
export const MobileModal = ({ 
  isOpen, 
  onClose, 
  title, 
  children, 
  className = '',
  size = 'medium'
}) => {
  const { isMobile } = useResponsive();

  if (!isOpen) return null;

  const sizes = {
    small: isMobile ? 'max-w-sm' : 'max-w-md',
    medium: isMobile ? 'max-w-md' : 'max-w-lg',
    large: isMobile ? 'max-w-lg' : 'max-w-2xl',
    full: 'max-w-full'
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-full items-center justify-center p-4">
        {/* Backdrop */}
        <div 
          className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"
          onClick={onClose}
        />
        
        {/* Modal */}
        <div className={`
          relative transform overflow-hidden rounded-lg bg-white shadow-xl transition-all
          ${sizes[size]} w-full
          ${isMobile ? 'mx-4' : 'mx-auto'}
          ${className}
        `}>
          {title && (
            <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">{title}</h3>
            </div>
          )}
          <div className={isMobile ? 'p-4' : 'p-6'}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
};

// Mobile-optimized List component
export const MobileList = ({ children, className = '' }) => {
  return (
    <div className={`divide-y divide-gray-200 ${className}`}>
      {children}
    </div>
  );
};

export const MobileListItem = ({ 
  children, 
  onClick, 
  className = '',
  interactive = false 
}) => {
  const { isMobile } = useResponsive();
  const isTouch = useTouchDevice();

  const baseClasses = `
    ${isMobile ? 'py-4 px-4' : 'py-3 px-3'}
    ${interactive ? 'cursor-pointer hover:bg-gray-50 transition-colors duration-200 touch-manipulation' : ''}
    ${isTouch && interactive ? 'active:bg-gray-100' : ''}
    ${interactive ? 'min-h-12' : ''}
  `;

  const Component = onClick ? 'button' : 'div';

  return (
    <Component
      className={`${baseClasses} ${className} ${onClick ? 'w-full text-left' : ''}`}
      onClick={onClick}
    >
      {children}
    </Component>
  );
};

// Mobile-optimized Grid component
export const MobileGrid = ({ 
  children, 
  cols = 1, 
  gap = 'medium',
  className = '' 
}) => {
  const { isMobile, isTablet } = useResponsive();

  const getCols = () => {
    if (isMobile) return 1;
    if (isTablet) return Math.min(cols, 2);
    return cols;
  };

  const gaps = {
    small: 'gap-2',
    medium: 'gap-4',
    large: 'gap-6'
  };

  return (
    <div 
      className={`grid ${gaps[gap]} ${className}`}
      style={{ gridTemplateColumns: `repeat(${getCols()}, 1fr)` }}
    >
      {children}
    </div>
  );
};
