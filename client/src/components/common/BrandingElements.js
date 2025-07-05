import React from 'react';
import HarmonyLogo from './HarmonyLogo';

// School Motto Component
export const SchoolMotto = ({ variant = "primary", size = "md" }) => {
  const sizes = {
    sm: "text-sm",
    md: "text-base",
    lg: "text-lg",
    xl: "text-xl"
  };
  
  const variants = {
    primary: "text-harmony-primary",
    secondary: "text-harmony-secondary",
    accent: "text-harmony-accent",
    gold: "text-harmony-gold"
  };
  
  return (
    <div className="text-center space-y-2">
      <p className={`font-brand font-semibold ${sizes[size]} ${variants[variant]}`}>
        "Excellence in Education"
      </p>
      <p className={`font-display text-xs ${variants[variant]} opacity-80 tracking-widest uppercase`}>
        Since 2020 • Nurturing Tomorrow's Leaders
      </p>
    </div>
  );
};

// School Values Component
export const SchoolValues = () => {
  const values = [
    {
      title: "Excellence",
      description: "We strive for the highest standards in all we do",
      icon: "🏆",
      color: "harmony-gold"
    },
    {
      title: "Innovation",
      description: "We embrace new ideas and creative solutions",
      icon: "💡",
      color: "harmony-secondary"
    },
    {
      title: "Integrity",
      description: "We act with honesty and moral principles",
      icon: "🌟",
      color: "harmony-primary"
    },
    {
      title: "Community",
      description: "We build strong relationships and collaboration",
      icon: "🤝",
      color: "harmony-secondary"
    }
  ];
  
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      {values.map((value, index) => (
        <div key={index} className="card-harmony text-center">
          <div className="text-4xl mb-3">{value.icon}</div>
          <h3 className={`font-display font-semibold text-lg text-${value.color} mb-2`}>
            {value.title}
          </h3>
          <p className="text-sm text-gray-600">{value.description}</p>
        </div>
      ))}
    </div>
  );
};

// Achievement Badge Component
export const AchievementBadge = ({ type = "excellence", title, description, icon }) => {
  const badgeTypes = {
    excellence: {
      gradient: "bg-gradient-primary",
      icon: "🏆",
      title: "Excellence Award"
    },
    innovation: {
      gradient: "bg-gradient-secondary",
      icon: "💡",
      title: "Innovation Badge"
    },
    leadership: {
      gradient: "bg-gradient-primary",
      icon: "👑",
      title: "Leadership Recognition"
    },
    academic: {
      gradient: "bg-harmony-gold",
      icon: "🎓",
      title: "Academic Achievement"
    }
  };
  
  const badge = badgeTypes[type] || badgeTypes.excellence;
  
  return (
    <div className="inline-flex items-center space-x-3 p-4 bg-white rounded-lg shadow-harmony border border-gray-200">
      <div className={`achievement-medal ${badge.gradient}`}>
        {icon || badge.icon}
      </div>
      <div>
        <h4 className="font-display font-semibold text-gray-800">
          {title || badge.title}
        </h4>
        {description && (
          <p className="text-sm text-gray-600">{description}</p>
        )}
      </div>
    </div>
  );
};

// Grade Level Badge
export const GradeLevelBadge = ({ grade, level, students, className = "" }) => {
  const gradeColors = {
    "Pre-K": "bg-pink-100 text-pink-800 border-pink-200",
    "K": "bg-purple-100 text-purple-800 border-purple-200",
    "1": "bg-blue-100 text-blue-800 border-blue-200",
    "2": "bg-green-100 text-green-800 border-green-200",
    "3": "bg-yellow-100 text-yellow-800 border-yellow-200",
    "4": "bg-orange-100 text-orange-800 border-orange-200",
    "5": "bg-red-100 text-red-800 border-red-200",
    "6": "bg-indigo-100 text-indigo-800 border-indigo-200",
    "7": "bg-purple-100 text-purple-800 border-purple-200",
    "8": "bg-pink-100 text-pink-800 border-pink-200",
    "9": "bg-blue-100 text-blue-800 border-blue-200",
    "10": "bg-green-100 text-green-800 border-green-200",
    "11": "bg-yellow-100 text-yellow-800 border-yellow-200",
    "12": "bg-red-100 text-red-800 border-red-200"
  };
  
  return (
    <div className={`inline-flex items-center space-x-2 px-3 py-1 rounded-full border ${gradeColors[grade] || 'bg-gray-100 text-gray-800 border-gray-200'} ${className}`}>
      <span className="font-semibold text-sm">Grade {grade}</span>
      {level && <span className="text-xs opacity-75">• {level}</span>}
      {students && <span className="text-xs opacity-75">• {students} students</span>}
    </div>
  );
};

// Department Badge
export const DepartmentBadge = ({ department, className = "" }) => {
  const departments = {
    "Mathematics": { color: "blue", icon: "📐" },
    "Science": { color: "green", icon: "🔬" },
    "English": { color: "purple", icon: "📚" },
    "History": { color: "yellow", icon: "🏛️" },
    "Art": { color: "pink", icon: "🎨" },
    "Music": { color: "indigo", icon: "🎵" },
    "Physical Education": { color: "red", icon: "⚽" },
    "Technology": { color: "gray", icon: "💻" },
    "Languages": { color: "orange", icon: "🌍" }
  };
  
  const dept = departments[department] || { color: "gray", icon: "📖" };
  
  return (
    <div className={`inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-${dept.color}-100 text-${dept.color}-800 border border-${dept.color}-200 ${className}`}>
      <span className="text-sm">{dept.icon}</span>
      <span className="font-medium text-sm">{department}</span>
    </div>
  );
};

// Status Indicator
export const StatusIndicator = ({ status, label, className = "" }) => {
  const statusStyles = {
    active: "bg-green-100 text-green-800 border-green-200",
    pending: "bg-yellow-100 text-yellow-800 border-yellow-200",
    inactive: "bg-gray-100 text-gray-800 border-gray-200",
    completed: "bg-blue-100 text-blue-800 border-blue-200",
    overdue: "bg-red-100 text-red-800 border-red-200"
  };
  
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${statusStyles[status] || statusStyles.inactive} ${className}`}>
      {label || status}
    </span>
  );
};

// School Header Component
export const SchoolHeader = ({ showMotto = true, theme = "primary" }) => {
  return (
    <div className="text-center space-y-4 py-8">
      <HarmonyLogo size={80} showText={true} theme={theme} />
      {showMotto && (
        <div className="space-y-2">
          <SchoolMotto variant={theme} size="lg" />
          <div className="flex flex-wrap justify-center gap-2 mt-4">
            <AchievementBadge type="excellence" />
            <AchievementBadge type="innovation" />
            <AchievementBadge type="academic" />
          </div>
        </div>
      )}
    </div>
  );
};

// Loading Spinner with Harmony Branding
export const HarmonyLoader = ({ size = "md" }) => {
  const sizes = {
    sm: "w-6 h-6",
    md: "w-8 h-8",
    lg: "w-12 h-12",
    xl: "w-16 h-16"
  };
  
  return (
    <div className="flex items-center justify-center space-y-2">
      <div className={`${sizes[size]} relative`}>
        <div className="absolute inset-0 bg-gradient-primary rounded-full animate-ping opacity-75"></div>
        <div className="relative bg-gradient-primary rounded-full flex items-center justify-center text-white font-semibold">
          <HarmonyLogo size={size === "sm" ? 16 : size === "md" ? 20 : size === "lg" ? 32 : 40} showText={false} theme="white" />
        </div>
      </div>
      <p className="text-sm text-harmony-primary font-medium">Loading...</p>
    </div>
  );
};

// Academic Calendar Event
export const CalendarEvent = ({ title, date, type, className = "" }) => {
  const eventTypes = {
    exam: { color: "red", icon: "📝" },
    assignment: { color: "blue", icon: "📋" },
    event: { color: "green", icon: "📅" },
    holiday: { color: "yellow", icon: "🎉" },
    meeting: { color: "purple", icon: "👥" }
  };
  
  const event = eventTypes[type] || eventTypes.event;
  
  return (
    <div className={`flex items-center space-x-3 p-3 rounded-lg border-l-4 border-${event.color}-500 bg-${event.color}-50 ${className}`}>
      <div className="text-lg">{event.icon}</div>
      <div className="flex-1">
        <h4 className="font-medium text-gray-800">{title}</h4>
        <p className="text-sm text-gray-600">{date}</p>
      </div>
    </div>
  );
};

export default {
  SchoolMotto,
  SchoolValues,
  AchievementBadge,
  GradeLevelBadge,
  DepartmentBadge,
  StatusIndicator,
  SchoolHeader,
  HarmonyLoader,
  CalendarEvent
};
