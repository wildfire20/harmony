import React from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { User, Mail, GraduationCap, Calendar } from 'lucide-react';

const Profile = () => {
  const { user } = useAuth();

  if (!user) {
    return null;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-gray-900">Profile</h1>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="flex items-center space-x-6">
          <div className="h-24 w-24 bg-pink-100 rounded-full flex items-center justify-center">
            <User className="h-12 w-12 text-pink-600" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-gray-900">
              {user.first_name} {user.last_name}
            </h2>
            <p className="text-gray-600 capitalize">{user.role}</p>
          </div>
        </div>

        <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div className="flex items-center space-x-3">
              <Mail className="h-5 w-5 text-gray-400" />
              <div>
                <p className="text-sm font-medium text-gray-900">Email</p>
                <p className="text-sm text-gray-600">{user.email || 'Not provided'}</p>
              </div>
            </div>
            
            {user.student_number && (
              <div className="flex items-center space-x-3">
                <GraduationCap className="h-5 w-5 text-gray-400" />
                <div>
                  <p className="text-sm font-medium text-gray-900">Student Number</p>
                  <p className="text-sm text-gray-600">{user.student_number}</p>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-4">
            {user.grade_name && (
              <div className="flex items-center space-x-3">
                <GraduationCap className="h-5 w-5 text-gray-400" />
                <div>
                  <p className="text-sm font-medium text-gray-900">Grade</p>
                  <p className="text-sm text-gray-600">{user.grade_name}</p>
                </div>
              </div>
            )}
            
            {user.class_name && (
              <div className="flex items-center space-x-3">
                <Calendar className="h-5 w-5 text-gray-400" />
                <div>
                  <p className="text-sm font-medium text-gray-900">Class</p>
                  <p className="text-sm text-gray-600">{user.class_name}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Profile;
