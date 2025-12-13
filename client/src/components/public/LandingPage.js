import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';

const schoolImages = [
  { src: '/images/school/574083654_859739219895882_5859464915249295367_n_1765536715569.jpg', alt: 'Harmony Learning Institute Entrance', caption: 'Welcome to Harmony Learning Institute' },
  { src: '/images/school/572776172_859739109895893_1292514017724096687_n_1765536715568.jpg', alt: 'Our Dedicated Staff', caption: 'Our Passionate Teaching Team' },
  { src: '/images/school/546959768_822582210278250_5565575276103000568_n_1765536715571.jpg', alt: 'Students Enjoying Activities', caption: 'Learning Through Fun Activities' },
  { src: '/images/school/585606417_878202904716180_1733055620027623180_n_1765536746198.jpg', alt: 'Students in Uniform', caption: 'Building Tomorrow\'s Leaders' },
  { src: '/images/school/579967972_869923822210755_7676298534031595389_n_1765536746196.jpg', alt: 'School Concert', caption: 'Celebrating Talent and Creativity' },
];

const galleryImages = [
  { src: '/images/school/552693350_830159562853848_3695668521832927477_n_1765536715561.jpg', alt: 'Heritage Day Celebration', category: 'Culture' },
  { src: '/images/school/558220948_843198804883257_1331796588957140620_n_1765536715564.jpg', alt: 'Fun Day Activities', category: 'Activities' },
  { src: '/images/school/571020461_858591460010658_2205033645939389574_n_1765536715566.jpg', alt: 'Computer Lab Learning', category: 'Technology' },
  { src: '/images/school/572089308_859738236562647_1058946190080182228_n_1765536715567.jpg', alt: 'Field Trip Adventure', category: 'Excursions' },
  { src: '/images/school/542757838_812685227934615_1612604276869659548_n_1765536715570.jpg', alt: 'Fire Safety Day', category: 'Learning' },
  { src: '/images/school/547212707_824173240119147_8225029070731606342_n_1765536715572.jpg', alt: 'Student Portraits', category: 'Students' },
  { src: '/images/school/589068204_883907127479091_6403058270590047581_n_1765536746193.jpg', alt: 'Graduation Ceremony Setup', category: 'Events' },
  { src: '/images/school/589306128_883951014141369_2429705641371166214_n_1765536746195.jpg', alt: 'Graduation Day', category: 'Events' },
  { src: '/images/school/586021157_878203054716165_8351932850885782583_n_1765536746200.jpg', alt: 'School Buildings', category: 'Campus' },
];

const Header = () => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 50);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <header className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${scrolled ? 'bg-white shadow-lg' : 'bg-white/90 backdrop-blur-md'}`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 md:h-20">
          <a href="/" className="flex items-center gap-3">
            <img 
              src="/images/harmony-logo.png" 
              alt="Harmony Learning Institute" 
              className="h-12 w-12 object-contain"
            />
            <div>
              <span className="font-bold text-xl text-red-600">Harmony Learning</span>
              <span className="block text-xs text-blue-800 font-medium">Institute</span>
            </div>
          </a>

          <nav className="hidden md:flex items-center gap-8">
            <a href="#about" className="text-sm font-medium text-gray-700 hover:text-red-600 transition-colors">About</a>
            <a href="#gallery" className="text-sm font-medium text-gray-700 hover:text-red-600 transition-colors">Gallery</a>
            <a href="#programs" className="text-sm font-medium text-gray-700 hover:text-red-600 transition-colors">Programs</a>
            <a href="#enroll" className="text-sm font-medium text-gray-700 hover:text-red-600 transition-colors">Enroll</a>
          </nav>

          <div className="flex items-center gap-3">
            <Link to="/login" className="hidden sm:inline-flex px-5 py-2.5 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors">
              Portal Login
            </Link>
            <a href="#enroll" className="hidden sm:inline-flex px-5 py-2.5 text-sm font-medium text-white bg-gradient-to-r from-red-600 to-pink-300 rounded-lg hover:from-red-600 hover:to-pink-400 transition-all shadow-lg hover:shadow-xl">
              Apply Now
            </a>
            <button
              className="md:hidden p-2 text-gray-600 hover:text-red-600"
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
          <div className="md:hidden py-4 border-t border-red-100 bg-white">
            <nav className="flex flex-col gap-2">
              <a href="#about" className="px-4 py-3 text-sm font-medium text-gray-700 hover:bg-red-50 hover:text-red-600 rounded-lg" onClick={() => setMobileMenuOpen(false)}>About</a>
              <a href="#gallery" className="px-4 py-3 text-sm font-medium text-gray-700 hover:bg-red-50 hover:text-red-600 rounded-lg" onClick={() => setMobileMenuOpen(false)}>Gallery</a>
              <a href="#programs" className="px-4 py-3 text-sm font-medium text-gray-700 hover:bg-red-50 hover:text-red-600 rounded-lg" onClick={() => setMobileMenuOpen(false)}>Programs</a>
              <a href="#enroll" className="px-4 py-3 text-sm font-medium text-gray-700 hover:bg-red-50 hover:text-red-600 rounded-lg" onClick={() => setMobileMenuOpen(false)}>Enroll</a>
              <div className="flex gap-2 px-4 pt-3">
                <Link to="/login" className="flex-1 py-3 text-sm font-medium text-center text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Portal Login</Link>
                <a href="#enroll" className="flex-1 py-3 text-sm font-medium text-center text-white bg-gradient-to-r from-red-600 to-pink-300 rounded-lg">Apply Now</a>
              </div>
            </nav>
          </div>
        )}
      </div>
    </header>
  );
};

const HeroSection = () => {
  const [currentSlide, setCurrentSlide] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % schoolImages.length);
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  return (
    <section className="relative min-h-screen pt-16 md:pt-20">
      <div className="absolute inset-0">
        {schoolImages.map((image, index) => (
          <div
            key={index}
            className={`absolute inset-0 transition-opacity duration-1000 ${index === currentSlide ? 'opacity-100' : 'opacity-0'}`}
          >
            <img
              src={image.src}
              alt={image.alt}
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/50 to-transparent" />
          </div>
        ))}
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 min-h-screen flex items-center">
        <div className="max-w-2xl py-20">
          <span className="inline-flex items-center gap-2 mb-6 px-4 py-2 text-sm font-semibold bg-red-600 text-white rounded-full shadow-lg">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
            </svg>
            Now Accepting Applications for 2025
          </span>

          <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold text-white mb-6 leading-tight">
            Welcome to{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-red-400 to-pink-200">
              Harmony Learning
            </span>{" "}
            Institute
          </h1>

          <p className="text-lg sm:text-xl text-white/90 mb-8 leading-relaxed">
            Where every learner matters and every learner achieves. 
            Nurturing young minds from preschool through primary with excellence, 
            care, and a celebration of South African heritage.
          </p>

          <div className="flex flex-col sm:flex-row gap-4">
            <a href="#enroll" className="px-8 py-4 text-lg font-semibold text-gray-900 bg-gradient-to-r from-pink-200 to-red-400 rounded-xl hover:from-pink-300 hover:to-red-600 transition-all shadow-xl hover:shadow-2xl flex items-center justify-center gap-2">
              Enroll Your Child
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </a>
            <a href="#gallery" className="px-8 py-4 text-lg font-semibold text-white bg-white/20 backdrop-blur-md border-2 border-white/40 rounded-xl hover:bg-white/30 transition-all flex items-center justify-center">
              View Our Campus
            </a>
          </div>

          <div className="flex gap-2 mt-10">
            {schoolImages.map((_, index) => (
              <button
                key={index}
                onClick={() => setCurrentSlide(index)}
                className={`w-3 h-3 rounded-full transition-all ${index === currentSlide ? 'bg-red-600 w-8' : 'bg-white/50 hover:bg-white/80'}`}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-white to-transparent" />
    </section>
  );
};

const AboutSection = () => {
  return (
    <section id="about" className="py-20 md:py-32 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid md:grid-cols-2 gap-12 lg:gap-20 items-center">
          <div className="relative">
            <div className="grid grid-cols-2 gap-4">
              <img 
                src="/images/school/572776172_859739109895893_1292514017724096687_n_1765536715568.jpg" 
                alt="Our Staff" 
                className="rounded-2xl shadow-xl w-full h-48 md:h-64 object-cover"
              />
              <img 
                src="/images/school/547212707_824173240119147_8225029070731606342_n_1765536715572.jpg" 
                alt="Students" 
                className="rounded-2xl shadow-xl w-full h-48 md:h-64 object-cover mt-8"
              />
              <img 
                src="/images/school/585606417_878202904716180_1733055620027623180_n_1765536746198.jpg" 
                alt="Students in Uniform" 
                className="rounded-2xl shadow-xl w-full h-48 md:h-64 object-cover -mt-8"
              />
              <img 
                src="/images/school/571020461_858591460010658_2205033645939389574_n_1765536715566.jpg" 
                alt="Computer Lab" 
                className="rounded-2xl shadow-xl w-full h-48 md:h-64 object-cover"
              />
            </div>
            <div className="absolute -bottom-6 -right-6 bg-gradient-to-br from-red-600 to-pink-300 rounded-2xl p-6 shadow-xl text-white hidden md:block">
              <div className="text-4xl font-bold">15+</div>
              <div className="text-sm opacity-90">Years of Excellence</div>
            </div>
          </div>

          <div>
            <span className="inline-block px-4 py-1.5 bg-red-100 text-red-700 rounded-full text-sm font-semibold mb-4">About Us</span>
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-gray-900 mb-6">
              An Exceptional School Where Every Learner <span className="text-red-600">Thrives</span>
            </h2>
            <p className="text-lg text-gray-600 mb-6 leading-relaxed">
              At Harmony Learning Institute, we believe in creating an inclusive and progressive learning 
              environment. Our mission is to nurture each child's unique potential while celebrating 
              South African heritage and culture.
            </p>
            <div className="bg-gradient-to-r from-blue-900 to-blue-800 rounded-xl p-6 mb-8 text-white">
              <h3 className="font-bold text-lg mb-2 flex items-center gap-2">
                <svg className="w-5 h-5 text-pink-200" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                  <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
                </svg>
                Our Vision
              </h3>
              <p className="text-white/90">
                To be an exceptional school; inclusive and progressive, where every learner matters 
                and where every learner achieves.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-center gap-3 p-4 bg-red-50 rounded-xl">
                <div className="w-12 h-12 bg-red-600 rounded-full flex items-center justify-center text-white">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                  </svg>
                </div>
                <div>
                  <div className="font-bold text-gray-900">Quality Education</div>
                  <div className="text-sm text-gray-600">Expert teachers</div>
                </div>
              </div>
              <div className="flex items-center gap-3 p-4 bg-red-50 rounded-xl">
                <div className="w-12 h-12 bg-red-600 rounded-full flex items-center justify-center text-white">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                  </svg>
                </div>
                <div>
                  <div className="font-bold text-gray-900">Caring Environment</div>
                  <div className="text-sm text-gray-600">Safe & nurturing</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

const GallerySection = () => {
  const [selectedImage, setSelectedImage] = useState(null);

  return (
    <section id="gallery" className="py-20 md:py-32 bg-gradient-to-b from-red-50 to-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <span className="inline-block px-4 py-1.5 bg-red-100 text-red-700 rounded-full text-sm font-semibold mb-4">Life at Harmony</span>
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-gray-900 mb-4">
            Experience Our <span className="text-red-600">Vibrant</span> School Life
          </h2>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            From heritage celebrations to field trips, concerts to classroom learning - 
            see how our students grow, learn, and thrive every day.
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {galleryImages.map((image, index) => (
            <div
              key={index}
              className={`relative group cursor-pointer overflow-hidden rounded-xl shadow-lg transition-all duration-300 hover:shadow-2xl hover:scale-105 ${index === 0 || index === 5 ? 'md:col-span-2 md:row-span-2' : ''}`}
              onClick={() => setSelectedImage(image)}
            >
              <img
                src={image.src}
                alt={image.alt}
                className="w-full h-48 md:h-full object-cover transition-transform duration-500 group-hover:scale-110"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                <div className="absolute bottom-0 left-0 right-0 p-4">
                  <span className="inline-block px-3 py-1 bg-red-600 text-white text-xs font-semibold rounded-full mb-2">
                    {image.category}
                  </span>
                  <p className="text-white font-medium">{image.alt}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {selectedImage && (
          <div 
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
            onClick={() => setSelectedImage(null)}
          >
            <button 
              className="absolute top-4 right-4 text-white hover:text-red-400 transition-colors"
              onClick={() => setSelectedImage(null)}
            >
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <img
              src={selectedImage.src}
              alt={selectedImage.alt}
              className="max-w-full max-h-[90vh] object-contain rounded-lg"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        )}
      </div>
    </section>
  );
};

const ProgramsSection = () => {
  const programs = [
    {
      title: "Preschool",
      ages: "Ages 3-5",
      description: "A nurturing foundation where young minds begin their learning journey through play, discovery, and creative expression.",
      features: ["Play-based learning", "Creative development", "Social skills", "Basic literacy"],
      image: "/images/school/552693350_830159562853848_3695668521832927477_n_1765536715561.jpg",
      color: "from-pink-200 to-red-400"
    },
    {
      title: "Primary School",
      ages: "Grades 1-7",
      description: "Comprehensive education focusing on academic excellence, character development, and preparing students for future success.",
      features: ["Core academics", "Computer literacy", "Sports & arts", "Heritage education"],
      image: "/images/school/585606417_878202904716180_1733055620027623180_n_1765536746198.jpg",
      color: "from-red-500 to-red-600"
    },
    {
      title: "Boarding",
      ages: "All Ages",
      description: "A home away from home providing 24/7 care, supervision, and a structured environment for learners.",
      features: ["Safe accommodation", "Supervised study", "Nutritious meals", "Character building"],
      image: "/images/school/586021157_878203054716165_8351932850885782583_n_1765536746200.jpg",
      color: "from-blue-800 to-blue-900"
    }
  ];

  return (
    <section id="programs" className="py-20 md:py-32 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <span className="inline-block px-4 py-1.5 bg-red-100 text-red-700 rounded-full text-sm font-semibold mb-4">Our Programs</span>
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-gray-900 mb-4">
            Programs Designed for <span className="text-red-600">Success</span>
          </h2>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            From early childhood to primary education, we offer comprehensive programs 
            that nurture every aspect of your child's development.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          {programs.map((program, index) => (
            <div key={index} className="group relative bg-white rounded-2xl shadow-xl overflow-hidden hover:shadow-2xl transition-all duration-300">
              <div className="relative h-56 overflow-hidden">
                <img 
                  src={program.image} 
                  alt={program.title}
                  className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                />
                <div className={`absolute inset-0 bg-gradient-to-t ${program.color} opacity-60`} />
                <div className="absolute bottom-4 left-4 right-4">
                  <span className="text-white/80 text-sm font-medium">{program.ages}</span>
                  <h3 className="text-2xl font-bold text-white">{program.title}</h3>
                </div>
              </div>
              <div className="p-6">
                <p className="text-gray-600 mb-4">{program.description}</p>
                <ul className="space-y-2">
                  {program.features.map((feature, idx) => (
                    <li key={idx} className="flex items-center gap-2 text-sm text-gray-700">
                      <svg className="w-4 h-4 text-red-600 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                      {feature}
                    </li>
                  ))}
                </ul>
              </div>
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
      <section id="enroll" className="py-20 md:py-32 bg-gradient-to-b from-red-50 to-pink-50">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="bg-white rounded-2xl shadow-2xl p-12 text-center">
            <div className="w-20 h-20 bg-gradient-to-r from-green-400 to-green-500 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="text-3xl font-bold mb-4 text-gray-900">Application Received!</h3>
            <p className="text-gray-600 mb-8 text-lg">
              Thank you for choosing Harmony Learning Institute. 
              Our admissions team will review your application and contact you within 48 hours.
            </p>
            <button 
              onClick={() => setSubmitted(false)} 
              className="px-8 py-4 bg-gradient-to-r from-red-600 to-pink-300 text-white font-semibold rounded-xl hover:from-red-600 hover:to-pink-400 transition-all shadow-lg"
            >
              Submit Another Application
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section id="enroll" className="py-20 md:py-32 bg-gradient-to-b from-red-50 to-pink-50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid lg:grid-cols-2 gap-12 items-start">
          <div>
            <span className="inline-block px-4 py-1.5 bg-red-100 text-red-700 rounded-full text-sm font-semibold mb-4">Enroll Now</span>
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-gray-900 mb-6">
              Ready to Join Our <span className="text-red-600">Family?</span>
            </h2>
            <p className="text-lg text-gray-600 mb-8">
              Begin your child's journey with Harmony Learning Institute. 
              Fill out the form and we'll be in touch soon to discuss the next steps.
            </p>
            
            <div className="space-y-6">
              <div className="flex items-start gap-4 p-4 bg-white rounded-xl shadow-md">
                <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <h4 className="font-bold text-gray-900">Easy Application</h4>
                  <p className="text-sm text-gray-600">Simple online form - takes just 5 minutes</p>
                </div>
              </div>
              <div className="flex items-start gap-4 p-4 bg-white rounded-xl shadow-md">
                <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <h4 className="font-bold text-gray-900">Quick Response</h4>
                  <p className="text-sm text-gray-600">We'll contact you within 48 hours</p>
                </div>
              </div>
              <div className="flex items-start gap-4 p-4 bg-white rounded-xl shadow-md">
                <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </div>
                <div>
                  <h4 className="font-bold text-gray-900">Campus Visit</h4>
                  <p className="text-sm text-gray-600">Schedule a tour to meet our team</p>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-2xl p-8">
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
              <div className="border-b border-gray-200 pb-4 mb-6">
                <h3 className="text-xl font-bold text-gray-900">Parent/Guardian Information</h3>
              </div>
              
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">First Name *</label>
                  <input
                    type="text"
                    {...register('parentFirstName', { required: 'First name is required' })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-600 focus:border-transparent"
                    placeholder="First Name"
                  />
                  {errors.parentFirstName && <p className="mt-1 text-sm text-red-600">{errors.parentFirstName.message}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Last Name *</label>
                  <input
                    type="text"
                    {...register('parentLastName', { required: 'Last name is required' })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-600 focus:border-transparent"
                    placeholder="Last Name"
                  />
                  {errors.parentLastName && <p className="mt-1 text-sm text-red-600">{errors.parentLastName.message}</p>}
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
                  <input
                    type="email"
                    {...register('parentEmail', { 
                      required: 'Email is required',
                      pattern: { value: /^\S+@\S+$/i, message: 'Invalid email address' }
                    })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-600 focus:border-transparent"
                    placeholder="email@example.com"
                  />
                  {errors.parentEmail && <p className="mt-1 text-sm text-red-600">{errors.parentEmail.message}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Phone *</label>
                  <input
                    type="tel"
                    {...register('parentPhone', { required: 'Phone number is required' })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-600 focus:border-transparent"
                    placeholder="Phone Number"
                  />
                  {errors.parentPhone && <p className="mt-1 text-sm text-red-600">{errors.parentPhone.message}</p>}
                </div>
              </div>

              <div className="border-b border-gray-200 pb-4 mb-6 pt-4">
                <h3 className="text-xl font-bold text-gray-900">Student Information</h3>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Student First Name *</label>
                  <input
                    type="text"
                    {...register('studentFirstName', { required: 'Student first name is required' })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-600 focus:border-transparent"
                    placeholder="Student First Name"
                  />
                  {errors.studentFirstName && <p className="mt-1 text-sm text-red-600">{errors.studentFirstName.message}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Student Last Name *</label>
                  <input
                    type="text"
                    {...register('studentLastName', { required: 'Student last name is required' })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-600 focus:border-transparent"
                    placeholder="Student Last Name"
                  />
                  {errors.studentLastName && <p className="mt-1 text-sm text-red-600">{errors.studentLastName.message}</p>}
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date of Birth *</label>
                  <input
                    type="date"
                    {...register('studentDateOfBirth', { required: 'Date of birth is required' })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-600 focus:border-transparent"
                  />
                  {errors.studentDateOfBirth && <p className="mt-1 text-sm text-red-600">{errors.studentDateOfBirth.message}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Grade Applying For *</label>
                  <select
                    {...register('gradeApplying', { required: 'Please select a grade' })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-600 focus:border-transparent"
                  >
                    <option value="">Select Grade</option>
                    {grades.map(grade => (
                      <option key={grade.value} value={grade.value}>{grade.label}</option>
                    ))}
                  </select>
                  {errors.gradeApplying && <p className="mt-1 text-sm text-red-600">{errors.gradeApplying.message}</p>}
                </div>
              </div>

              <div className="flex items-center gap-3 p-4 bg-blue-50 rounded-lg">
                <input
                  type="checkbox"
                  {...register('boardingOption')}
                  className="w-5 h-5 text-red-600 border-gray-300 rounded focus:ring-red-600"
                />
                <label className="text-sm text-gray-700">
                  <span className="font-medium">Interested in Boarding?</span>
                  <br />
                  <span className="text-gray-500">Check if you'd like to explore our boarding facilities</span>
                </label>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Previous School (if any)</label>
                <input
                  type="text"
                  {...register('previousSchool')}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-600 focus:border-transparent"
                  placeholder="Name of previous school"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Additional Notes</label>
                <textarea
                  {...register('additionalNotes')}
                  rows={3}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-600 focus:border-transparent resize-none"
                  placeholder="Any additional information you'd like us to know..."
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-4 px-6 bg-gradient-to-r from-red-600 to-pink-300 text-white font-bold text-lg rounded-xl hover:from-red-600 hover:to-pink-400 transition-all shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Submitting...
                  </>
                ) : (
                  <>
                    Submit Application
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                  </>
                )}
              </button>
            </form>
          </div>
        </div>
      </div>
    </section>
  );
};

const Footer = () => {
  return (
    <footer className="bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid md:grid-cols-4 gap-12">
          <div className="md:col-span-2">
            <div className="flex items-center gap-3 mb-6">
              <img 
                src="/images/harmony-logo.png" 
                alt="Harmony Learning Institute" 
                className="h-14 w-14 object-contain bg-white rounded-lg p-1"
              />
              <div>
                <span className="font-bold text-xl text-red-400">Harmony Learning</span>
                <span className="block text-sm text-blue-400">Institute</span>
              </div>
            </div>
            <p className="text-gray-400 mb-6 max-w-md">
              Where every learner matters and every learner achieves. 
              An exceptional school that is inclusive and progressive.
            </p>
            <div className="flex gap-4">
              <a href="#" className="w-10 h-10 bg-white/10 rounded-lg flex items-center justify-center hover:bg-red-600 transition-colors">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M24 4.557c-.883.392-1.832.656-2.828.775 1.017-.609 1.798-1.574 2.165-2.724-.951.564-2.005.974-3.127 1.195-.897-.957-2.178-1.555-3.594-1.555-3.179 0-5.515 2.966-4.797 6.045-4.091-.205-7.719-2.165-10.148-5.144-1.29 2.213-.669 5.108 1.523 6.574-.806-.026-1.566-.247-2.229-.616-.054 2.281 1.581 4.415 3.949 4.89-.693.188-1.452.232-2.224.084.626 1.956 2.444 3.379 4.6 3.419-2.07 1.623-4.678 2.348-7.29 2.04 2.179 1.397 4.768 2.212 7.548 2.212 9.142 0 14.307-7.721 13.995-14.646.962-.695 1.797-1.562 2.457-2.549z"/></svg>
              </a>
              <a href="#" className="w-10 h-10 bg-white/10 rounded-lg flex items-center justify-center hover:bg-red-600 transition-colors">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M22.675 0h-21.35c-.732 0-1.325.593-1.325 1.325v21.351c0 .731.593 1.324 1.325 1.324h11.495v-9.294h-3.128v-3.622h3.128v-2.671c0-3.1 1.893-4.788 4.659-4.788 1.325 0 2.463.099 2.795.143v3.24l-1.918.001c-1.504 0-1.795.715-1.795 1.763v2.313h3.587l-.467 3.622h-3.12v9.293h6.116c.73 0 1.323-.593 1.323-1.325v-21.35c0-.732-.593-1.325-1.325-1.325z"/></svg>
              </a>
              <a href="#" className="w-10 h-10 bg-white/10 rounded-lg flex items-center justify-center hover:bg-red-600 transition-colors">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>
              </a>
            </div>
          </div>

          <div>
            <h4 className="font-bold text-lg mb-4 text-red-400">Quick Links</h4>
            <ul className="space-y-3">
              <li><a href="#about" className="text-gray-400 hover:text-white transition-colors">About Us</a></li>
              <li><a href="#programs" className="text-gray-400 hover:text-white transition-colors">Our Programs</a></li>
              <li><a href="#gallery" className="text-gray-400 hover:text-white transition-colors">Gallery</a></li>
              <li><a href="#enroll" className="text-gray-400 hover:text-white transition-colors">Enrollment</a></li>
              <li><Link to="/login" className="text-gray-400 hover:text-white transition-colors">Portal Login</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="font-bold text-lg mb-4 text-red-400">Contact Us</h4>
            <ul className="space-y-3 text-gray-400">
              <li className="flex items-start gap-3">
                <svg className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span>Waterberg District<br />Limpopo, South Africa</span>
              </li>
              <li className="flex items-center gap-3">
                <svg className="w-5 h-5 text-red-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                </svg>
                <span>+27 (0) 80 001 1660</span>
              </li>
              <li className="flex items-center gap-3">
                <svg className="w-5 h-5 text-red-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                <span>info@harmonylearning.edu</span>
              </li>
            </ul>
          </div>
        </div>
      </div>

      <div className="border-t border-gray-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-gray-500 text-sm">
              &copy; {new Date().getFullYear()} Harmony Learning Institute. All rights reserved.
            </p>
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <img 
                  src="/images/harmony-logo.png" 
                  alt="Harmony Learning Institute" 
                  className="h-8 w-8 object-contain bg-white rounded-full p-0.5"
                />
                <span className="text-gray-400 text-xs">Harmony Learning</span>
              </div>
              <div className="w-px h-6 bg-gray-700" />
              <div className="flex items-center gap-2">
                <img 
                  src="/images/autom8-logo.png" 
                  alt="AutoM8" 
                  className="h-8 w-8 object-contain"
                />
                <div className="text-gray-400 text-xs">
                  <span className="block">Powered by</span>
                  <span className="text-blue-400 font-medium">AutoM8</span>
                </div>
              </div>
            </div>
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
      <HeroSection />
      <AboutSection />
      <GallerySection />
      <ProgramsSection />
      <EnrollmentSection />
      <Footer />
    </div>
  );
};

export default LandingPage;
