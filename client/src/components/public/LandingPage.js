import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import api from '../../services/api';

const Header = () => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <a href="/" className="flex items-center gap-2">
            <div className="w-10 h-10 bg-pink-500 rounded-lg flex items-center justify-center">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            </div>
            <span className="font-bold text-xl text-gray-900">Harmony Learning</span>
          </a>

          <nav className="hidden md:flex items-center gap-6">
            <a href="#about" className="text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">About</a>
            <a href="#programs" className="text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">Programs</a>
            <a href="#enroll" className="text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">Enroll</a>
          </nav>

          <div className="flex items-center gap-3">
            <Link to="/login" className="hidden sm:inline-flex px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors">
              Portal Login
            </Link>
            <a href="#enroll" className="hidden sm:inline-flex px-4 py-2 text-sm font-medium text-white bg-pink-500 rounded-lg hover:bg-pink-600 transition-colors">
              Apply Now
            </a>
            <button
              className="md:hidden p-2 text-gray-600 hover:text-gray-900"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? (
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              )}
            </button>
          </div>
        </div>

        {mobileMenuOpen && (
          <div className="md:hidden py-4 border-t">
            <nav className="flex flex-col gap-2">
              <a href="#about" className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-md" onClick={() => setMobileMenuOpen(false)}>About</a>
              <a href="#programs" className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-md" onClick={() => setMobileMenuOpen(false)}>Programs</a>
              <a href="#enroll" className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-md" onClick={() => setMobileMenuOpen(false)}>Enroll</a>
              <div className="flex gap-2 px-4 pt-2">
                <Link to="/login" className="flex-1 py-2 text-sm font-medium text-center text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Portal Login</Link>
                <a href="#enroll" className="flex-1 py-2 text-sm font-medium text-center text-white bg-pink-500 rounded-lg hover:bg-pink-600">Apply Now</a>
              </div>
            </nav>
          </div>
        )}
      </div>
    </header>
  );
};

const HeroSection = () => {
  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden bg-gradient-to-br from-pink-500 via-pink-600 to-rose-600">
      <div className="absolute inset-0 bg-black/30" />
      
      <div className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center py-20">
        <span className="inline-flex items-center gap-2 mb-6 px-4 py-2 text-sm font-medium bg-white/20 backdrop-blur-md text-white border border-white/30 rounded-full">
          <span>Now Accepting Applications for 2025</span>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </span>

        <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold text-white mb-6 leading-tight">
          Welcome to{" "}
          <span className="bg-gradient-to-r from-pink-200 to-rose-200 bg-clip-text text-transparent">
            Harmony Learning
          </span>{" "}
          Institute
        </h1>

        <p className="text-lg sm:text-xl md:text-2xl text-white/90 mb-8 max-w-3xl mx-auto leading-relaxed">
          Nurturing Young Minds from Preschool Through Primary
        </p>

        <p className="text-base sm:text-lg text-white/80 mb-10 max-w-2xl mx-auto">
          Where every child is valued, every moment is a learning opportunity, 
          and every day brings new discoveries. Join our family of learners today.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-12">
          <a href="#enroll" className="w-full sm:w-auto px-8 py-4 text-lg font-medium text-pink-600 bg-white rounded-lg hover:bg-gray-100 transition-colors flex items-center justify-center gap-2">
            Enroll Your Child
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </a>
          <a href="#about" className="w-full sm:w-auto px-8 py-4 text-lg font-medium text-white bg-white/10 backdrop-blur-md border border-white/30 rounded-lg hover:bg-white/20 transition-colors">
            Learn More
          </a>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl mx-auto">
          <div className="flex items-center justify-center gap-2 bg-white/10 backdrop-blur-md rounded-lg px-4 py-3">
            <svg className="w-5 h-5 text-pink-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 14l9-5-9-5-9 5 9 5z" />
            </svg>
            <span className="text-white/90 font-medium">Preschool</span>
          </div>
          <div className="flex items-center justify-center gap-2 bg-white/10 backdrop-blur-md rounded-lg px-4 py-3">
            <svg className="w-5 h-5 text-pink-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
            <span className="text-white/90 font-medium">Primary School</span>
          </div>
          <div className="flex items-center justify-center gap-2 bg-white/10 backdrop-blur-md rounded-lg px-4 py-3">
            <svg className="w-5 h-5 text-pink-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
            <span className="text-white/90 font-medium">Boarding</span>
          </div>
        </div>
      </div>
    </section>
  );
};

const AboutSection = () => {
  const values = [
    { icon: "heart", title: "Nurturing Environment", description: "Every child receives individual attention and care in our warm, supportive classrooms." },
    { icon: "book", title: "Quality Education", description: "Our curriculum balances academic excellence with creative exploration and practical skills." },
    { icon: "home", title: "Boarding Facilities", description: "Safe, comfortable boarding options with supervised activities and wholesome meals." },
    { icon: "award", title: "Holistic Development", description: "We focus on developing the whole child - intellectually, emotionally, and socially." }
  ];

  const getIcon = (type) => {
    const icons = {
      heart: <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>,
      book: <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>,
      home: <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>,
      award: <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" /></svg>,
    };
    return icons[type];
  };

  return (
    <section id="about" className="py-20 md:py-32 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          <div>
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold mb-6 text-gray-900">
              Building Tomorrow's Leaders{" "}
              <span className="text-pink-500">Today</span>
            </h2>
            
            <p className="text-lg text-gray-600 mb-8 leading-relaxed">
              At Harmony Learning Institute, we believe that every child has unique potential waiting to be unlocked. 
              Our dedicated team of educators creates an environment where curiosity thrives, 
              creativity flourishes, and confidence grows.
            </p>
            
            <p className="text-base text-gray-600 mb-8 leading-relaxed">
              Founded on the principles of excellence and care, we offer comprehensive education 
              from preschool through primary school, with boarding options for families seeking 
              a complete learning experience for their children.
            </p>

            <div className="grid grid-cols-2 gap-4">
              {values.map((value, index) => (
                <div key={index} className="bg-pink-50 rounded-lg p-4">
                  <div className="text-pink-500 mb-3">{getIcon(value.icon)}</div>
                  <h3 className="font-semibold mb-1 text-sm text-gray-900">{value.title}</h3>
                  <p className="text-xs text-gray-600">{value.description}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="relative">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-4">
                <div className="bg-gray-200 rounded-lg aspect-[4/5] flex items-center justify-center">
                  <svg className="w-16 h-16 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
                <div className="bg-pink-500 rounded-lg p-6 text-white">
                  <div className="text-3xl font-bold mb-1">500+</div>
                  <div className="text-sm opacity-90">Happy Learners</div>
                </div>
              </div>
              <div className="space-y-4 pt-8">
                <div className="bg-pink-50 rounded-lg p-6">
                  <div className="text-3xl font-bold text-pink-500 mb-1">25+</div>
                  <div className="text-sm text-gray-600">Dedicated Teachers</div>
                </div>
                <div className="bg-gray-200 rounded-lg aspect-[4/5] flex items-center justify-center">
                  <svg className="w-16 h-16 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

const ProgramsSection = () => {
  const programs = [
    { title: "Preschool (Ages 3-5)", description: "A nurturing introduction to learning through play, creativity, and social interaction.", features: ["Play-based learning", "Early literacy & numeracy", "Creative arts", "Social skills development"] },
    { title: "Foundation Phase (Grades 1-3)", description: "Building strong foundations in reading, writing, and mathematics.", features: ["Core subjects mastery", "Afrikaans & English", "Life skills", "Physical education"] },
    { title: "Intermediate Phase (Grades 4-6)", description: "Developing critical thinking and preparing for higher education.", features: ["Advanced academics", "Science & Technology", "Social Sciences", "Extra-curricular activities"] }
  ];

  return (
    <section id="programs" className="py-20 md:py-32 bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold mb-4 text-gray-900">
            Our <span className="text-pink-500">Programs</span>
          </h2>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            Comprehensive education programs designed to nurture each child's unique potential and prepare them for a bright future.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          {programs.map((program, index) => (
            <div key={index} className="bg-white rounded-xl p-6 shadow-lg hover:shadow-xl transition-shadow">
              <h3 className="text-xl font-bold mb-3 text-gray-900">{program.title}</h3>
              <p className="text-gray-600 mb-4">{program.description}</p>
              <ul className="space-y-2">
                {program.features.map((feature, i) => (
                  <li key={i} className="flex items-center gap-2 text-sm text-gray-600">
                    <svg className="w-5 h-5 text-pink-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    {feature}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

const EnrollmentSection = () => {
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  
  const { register, handleSubmit, formState: { errors }, reset } = useForm();

  const grades = [
    { value: "preschool-3", label: "Preschool (Age 3)" },
    { value: "preschool-4", label: "Preschool (Age 4)" },
    { value: "preschool-5", label: "Preschool (Age 5)" },
    { value: "grade-1", label: "Grade 1" },
    { value: "grade-2", label: "Grade 2" },
    { value: "grade-3", label: "Grade 3" },
    { value: "grade-4", label: "Grade 4" },
    { value: "grade-5", label: "Grade 5" },
    { value: "grade-6", label: "Grade 6" },
    { value: "grade-7", label: "Grade 7" },
    { value: "grade-8", label: "Grade 8" },
    { value: "grade-9", label: "Grade 9" },
    { value: "grade-10", label: "Grade 10" },
    { value: "grade-11", label: "Grade 11" },
    { value: "grade-12", label: "Grade 12" },
  ];

  const onSubmit = async (data) => {
    setLoading(true);
    try {
      const response = await fetch('/api/enrollments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          parentFirstName: data.parentFirstName,
          parentLastName: data.parentLastName,
          parentEmail: data.parentEmail,
          parentPhone: data.parentPhone,
          studentFirstName: data.studentFirstName,
          studentLastName: data.studentLastName,
          studentDateOfBirth: data.studentDateOfBirth,
          gradeApplying: data.gradeApplying,
          boardingOption: data.boardingOption || false,
          previousSchool: data.previousSchool,
          additionalNotes: data.additionalNotes
        }),
      });
      
      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.message || 'Failed to submit application');
      }
      
      setSubmitted(true);
      toast.success('Application submitted successfully!');
      reset();
    } catch (error) {
      console.error('Enrollment error:', error);
      toast.error(error.message || 'Failed to submit application. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <section id="enroll" className="py-20 md:py-32 bg-pink-50">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="bg-white rounded-xl shadow-xl p-12 text-center">
            <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg className="w-10 h-10 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="text-2xl font-bold mb-4 text-gray-900">Application Received!</h3>
            <p className="text-gray-600 mb-6">
              Thank you for your interest in Harmony Learning Institute. 
              Our admissions team will review your application and contact you within 48 hours.
            </p>
            <button 
              onClick={() => setSubmitted(false)} 
              className="px-6 py-3 bg-pink-500 text-white font-medium rounded-lg hover:bg-pink-600 transition-colors"
            >
              Submit Another Application
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section id="enroll" className="py-20 md:py-32 bg-pink-50">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold mb-4 text-gray-900">
            Ready to Join Our <span className="text-pink-500">Family?</span>
          </h2>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            Begin your child's journey with Harmony Learning Institute. 
            Fill out the form below and we'll be in touch soon.
          </p>
        </div>

        <div className="bg-white rounded-xl shadow-xl overflow-hidden">
          <div className="p-6 border-b border-gray-200">
            <h3 className="text-xl font-bold text-gray-900">Enrollment Application</h3>
            <p className="text-sm text-gray-500">Please provide accurate information. All fields marked with * are required.</p>
          </div>
          
          <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-8">
            <div>
              <h4 className="text-lg font-semibold mb-4 text-gray-900">Parent/Guardian Information</h4>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">First Name *</label>
                  <input 
                    {...register("parentFirstName", { required: "First name is required", minLength: { value: 2, message: "Minimum 2 characters" } })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-pink-500"
                    placeholder="John"
                  />
                  {errors.parentFirstName && <p className="text-red-500 text-sm mt-1">{errors.parentFirstName.message}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Last Name *</label>
                  <input 
                    {...register("parentLastName", { required: "Last name is required", minLength: { value: 2, message: "Minimum 2 characters" } })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-pink-500"
                    placeholder="Doe"
                  />
                  {errors.parentLastName && <p className="text-red-500 text-sm mt-1">{errors.parentLastName.message}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email Address *</label>
                  <input 
                    type="email"
                    {...register("parentEmail", { required: "Email is required", pattern: { value: /^\S+@\S+$/i, message: "Invalid email" } })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-pink-500"
                    placeholder="john@example.com"
                  />
                  {errors.parentEmail && <p className="text-red-500 text-sm mt-1">{errors.parentEmail.message}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number *</label>
                  <input 
                    {...register("parentPhone", { required: "Phone is required", minLength: { value: 10, message: "Invalid phone number" } })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-pink-500"
                    placeholder="+27 12 345 6789"
                  />
                  {errors.parentPhone && <p className="text-red-500 text-sm mt-1">{errors.parentPhone.message}</p>}
                </div>
              </div>
            </div>

            <div>
              <h4 className="text-lg font-semibold mb-4 text-gray-900">Student Information</h4>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Student First Name *</label>
                  <input 
                    {...register("studentFirstName", { required: "Student first name is required", minLength: { value: 2, message: "Minimum 2 characters" } })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-pink-500"
                    placeholder="Jane"
                  />
                  {errors.studentFirstName && <p className="text-red-500 text-sm mt-1">{errors.studentFirstName.message}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Student Last Name *</label>
                  <input 
                    {...register("studentLastName", { required: "Student last name is required", minLength: { value: 2, message: "Minimum 2 characters" } })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-pink-500"
                    placeholder="Doe"
                  />
                  {errors.studentLastName && <p className="text-red-500 text-sm mt-1">{errors.studentLastName.message}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date of Birth *</label>
                  <input 
                    type="date"
                    {...register("studentDateOfBirth", { required: "Date of birth is required" })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-pink-500"
                  />
                  {errors.studentDateOfBirth && <p className="text-red-500 text-sm mt-1">{errors.studentDateOfBirth.message}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Grade Applying For *</label>
                  <select 
                    {...register("gradeApplying", { required: "Please select a grade" })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-pink-500"
                  >
                    <option value="">Select a grade</option>
                    {grades.map((grade) => (
                      <option key={grade.value} value={grade.value}>{grade.label}</option>
                    ))}
                  </select>
                  {errors.gradeApplying && <p className="text-red-500 text-sm mt-1">{errors.gradeApplying.message}</p>}
                </div>
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Previous School (if any)</label>
                <input 
                  {...register("previousSchool")}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-pink-500"
                  placeholder="Previous school name"
                />
              </div>
              <div className="flex items-start gap-3 border border-gray-300 rounded-lg p-4">
                <input 
                  type="checkbox"
                  {...register("boardingOption")}
                  className="mt-1 w-4 h-4 text-pink-500 border-gray-300 rounded focus:ring-pink-500"
                />
                <div>
                  <label className="block text-sm font-medium text-gray-700">Interested in Boarding</label>
                  <p className="text-xs text-gray-500">Check if you're interested in our boarding facilities</p>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Additional Notes</label>
              <textarea 
                {...register("additionalNotes")}
                rows={4}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-pink-500"
                placeholder="Any additional information you'd like us to know..."
              />
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t border-gray-200">
              <p className="text-sm text-gray-500">
                We'll review your application and contact you within 48 hours.
              </p>
              <button 
                type="submit" 
                disabled={loading}
                className="w-full sm:w-auto px-6 py-3 bg-pink-500 text-white font-medium rounded-lg hover:bg-pink-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Submitting...
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                    </svg>
                    Submit Application
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </section>
  );
};

const Footer = () => {
  return (
    <footer className="bg-gray-900 text-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 bg-pink-500 rounded-lg flex items-center justify-center">
                <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
              </div>
            </div>
            <p className="text-gray-400 text-sm mb-6">
              Nurturing young minds from preschool through primary. 
              Where every child discovers their potential.
            </p>
          </div>

          <div>
            <h4 className="font-semibold text-lg mb-4">Quick Links</h4>
            <ul className="space-y-3">
              <li><a href="#about" className="text-gray-400 hover:text-white text-sm transition-colors">About Us</a></li>
              <li><a href="#programs" className="text-gray-400 hover:text-white text-sm transition-colors">Our Programs</a></li>
              <li><a href="#enroll" className="text-gray-400 hover:text-white text-sm transition-colors">Admissions</a></li>
              <li><Link to="/login" className="text-gray-400 hover:text-white text-sm transition-colors">Student Portal</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold text-lg mb-4">Contact Info</h4>
            <ul className="space-y-3 text-sm text-gray-400">
              <li className="flex items-start gap-3">
                <svg className="w-5 h-5 text-pink-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span>123 Education Drive<br />Harmony City, HC 12345</span>
              </li>
              <li className="flex items-center gap-3">
                <svg className="w-5 h-5 text-pink-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                </svg>
                <span>+27 12 345 6789</span>
              </li>
              <li className="flex items-center gap-3">
                <svg className="w-5 h-5 text-pink-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                <span>info@harmonylearning.edu</span>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold text-lg mb-4">Hours</h4>
            <ul className="space-y-3 text-sm text-gray-400">
              <li className="flex items-start gap-3">
                <svg className="w-5 h-5 text-pink-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>Mon - Fri: 7:00 AM - 5:00 PM<br />Sat: 8:00 AM - 12:00 PM</span>
              </li>
            </ul>
          </div>
        </div>
      </div>

      <div className="border-t border-gray-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-gray-500 text-sm">
              2025 Harmony Learning Institute. All rights reserved.
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
};

const LandingPage = () => {
  return (
    <div className="min-h-screen">
      <Header />
      <main>
        <HeroSection />
        <AboutSection />
        <ProgramsSection />
        <EnrollmentSection />
      </main>
      <Footer />
    </div>
  );
};

export default LandingPage;
