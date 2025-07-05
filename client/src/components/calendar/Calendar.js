import React from 'react';
import { Calendar as CalendarIcon, Plus, Filter } from 'lucide-react';

const Calendar = () => {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <CalendarIcon className="h-8 w-8 text-harmony-navy" />
          <h1 className="text-3xl font-bold text-gray-900">Calendar</h1>
        </div>
        <div className="flex space-x-3">
          <button className="bg-harmony-navy text-white px-4 py-2 rounded-md hover:bg-opacity-90 flex items-center space-x-2">
            <Filter className="h-4 w-4" />
            <span>Filter</span>
          </button>
          <button className="bg-harmony-secondary text-white px-4 py-2 rounded-md hover:bg-opacity-90 flex items-center space-x-2">
            <Plus className="h-4 w-4" />
            <span>Add Event</span>
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="text-center py-12">
          <CalendarIcon className="mx-auto h-16 w-16 text-gray-400 mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Calendar Coming Soon</h3>
          <p className="text-gray-600">The calendar feature is under development and will be available soon.</p>
        </div>
      </div>
    </div>
  );
};

export default Calendar;
