import React from 'react';
import { SchoolHeader, SchoolValues, AchievementBadge, CalendarEvent, HarmonyLoader } from '../common/BrandingElements';
import { ThemedCard, ThemedButton } from '../common/ThemeProvider';
import { GraduationCap, BookOpen, Users, Trophy, Calendar, Bell, Star } from 'lucide-react';

const WelcomeScreen = ({ user, onContinue }) => {
  const getWelcomeMessage = () => {
    const hour = new Date().getHours();
    let greeting = 'Good morning';
    if (hour >= 12 && hour < 17) greeting = 'Good afternoon';
    else if (hour >= 17) greeting = 'Good evening';

    return `${greeting}, ${user?.first_name || 'Student'}!`;
  };

  const getQuickActions = () => {
    if (user?.role === 'admin') {
      return [
        { title: 'Manage Users', icon: Users, color: 'primary', description: 'Add students and teachers' },
        { title: 'System Analytics', icon: Trophy, color: 'secondary', description: 'View performance metrics' },
        { title: 'School Settings', icon: BookOpen, color: 'primary', description: 'Configure system' }
      ];
    } else if (user?.role === 'teacher') {
      return [
        { title: 'Create Assignment', icon: BookOpen, color: 'primary', description: 'Assign new tasks' },
        { title: 'Grade Submissions', icon: Trophy, color: 'secondary', description: 'Review student work' },
        { title: 'Class Management', icon: Users, color: 'primary', description: 'Manage your classes' }
      ];
    } else {
      return [
        { title: 'View Assignments', icon: BookOpen, color: 'primary', description: 'Check pending tasks' },
        { title: 'Take Quizzes', icon: Trophy, color: 'secondary', description: 'Complete assessments' },
        { title: 'My Progress', icon: Star, color: 'primary', description: 'Track achievements' }
      ];
    }
  };

  const upcomingEvents = [
    { title: 'Math Quiz - Chapter 5', date: 'Tomorrow, 10:00 AM', type: 'exam' },
    { title: 'Science Project Due', date: 'Friday, July 7', type: 'assignment' },
    { title: 'Parent-Teacher Meeting', date: 'Monday, July 10', type: 'meeting' },
    { title: 'Summer Break Begins', date: 'Friday, July 14', type: 'holiday' }
  ];

  const achievements = [
    { type: 'excellence', title: 'Perfect Attendance', description: 'Never missed a class this term' },
    { type: 'academic', title: 'Quiz Champion', description: 'Scored 100% on 5 consecutive quizzes' },
    { type: 'innovation', title: 'Creative Thinker', description: 'Outstanding project presentation' }
  ];

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8 px-4">
      <div className="max-w-6xl mx-auto space-y-8">
        {/* School Header */}
        <SchoolHeader showMotto={true} theme="primary" />
        
        {/* Welcome Message */}
        <ThemedCard className="text-center">
          <h1 className="text-3xl font-brand font-bold text-harmony-primary mb-2">
            {getWelcomeMessage()}
          </h1>
          <p className="text-lg text-gray-600 dark:text-gray-300 mb-6">
            Welcome to your enhanced Harmony Learning Institute experience
          </p>
          <div className="flex flex-wrap justify-center gap-4 mb-6">
            <AchievementBadge type="excellence" title="System Upgraded" description="Enhanced with new features" />
            <AchievementBadge type="innovation" title="Dark Mode" description="New theme options available" />
            <AchievementBadge type="academic" title="Enhanced UI" description="Improved user experience" />
          </div>
          <ThemedButton 
            variant="primary" 
            size="lg" 
            onClick={onContinue}
            className="px-8 py-3"
          >
            Continue to Dashboard
          </ThemedButton>
        </ThemedCard>

        {/* Quick Actions */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="md:col-span-2">
            <h2 className="text-xl font-semibold text-harmony-primary mb-4">Quick Actions</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {getQuickActions().map((action, index) => (
                <ThemedCard key={index} variant="default" className="text-center hover:scale-105 transition-transform cursor-pointer">
                  <div className={`w-12 h-12 mx-auto mb-3 bg-harmony-${action.color} rounded-full flex items-center justify-center`}>
                    <action.icon className="w-6 h-6 text-white" />
                  </div>
                  <h3 className="font-medium text-gray-900 dark:text-white mb-1">{action.title}</h3>
                  <p className="text-sm text-gray-600 dark:text-gray-300">{action.description}</p>
                </ThemedCard>
              ))}
            </div>
          </div>

          {/* Upcoming Events */}
          <div>
            <h2 className="text-xl font-semibold text-harmony-primary mb-4">Upcoming Events</h2>
            <div className="space-y-3">
              {upcomingEvents.map((event, index) => (
                <CalendarEvent 
                  key={index}
                  title={event.title}
                  date={event.date}
                  type={event.type}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Achievements Section */}
        {user?.role === 'student' && (
          <div>
            <h2 className="text-xl font-semibold text-harmony-primary mb-4">Recent Achievements</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {achievements.map((achievement, index) => (
                <AchievementBadge 
                  key={index}
                  type={achievement.type}
                  title={achievement.title}
                  description={achievement.description}
                />
              ))}
            </div>
          </div>
        )}

        {/* School Values */}
        <div>
          <h2 className="text-2xl font-brand font-semibold text-harmony-primary mb-6 text-center">
            Our Core Values
          </h2>
          <SchoolValues />
        </div>

        {/* Statistics Summary */}
        <ThemedCard variant="primary">
          <h2 className="text-xl font-semibold text-center mb-6">
            System Statistics
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
            <div>
              <div className="text-3xl font-bold text-harmony-secondary mb-1">1,247</div>
              <div className="text-sm opacity-75">Active Students</div>
            </div>
            <div>
              <div className="text-3xl font-bold text-harmony-primary mb-1">89</div>
              <div className="text-sm opacity-75">Teachers</div>
            </div>
            <div>
              <div className="text-3xl font-bold text-harmony-secondary mb-1">156</div>
              <div className="text-sm opacity-75">Courses</div>
            </div>
            <div>
              <div className="text-3xl font-bold text-harmony-primary mb-1">98%</div>
              <div className="text-sm opacity-75">Satisfaction</div>
            </div>
          </div>
        </ThemedCard>

        {/* Continue Button */}
        <div className="text-center">
          <ThemedButton 
            variant="primary" 
            size="lg" 
            onClick={onContinue}
            className="px-12 py-4"
          >
            <GraduationCap className="w-5 h-5 mr-2" />
            Start Learning Journey
          </ThemedButton>
        </div>
      </div>
    </div>
  );
};

export default WelcomeScreen;
