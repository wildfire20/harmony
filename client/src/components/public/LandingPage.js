import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';

const HOME_IMAGE = '/images/homepage/';

const Arrow = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
  </svg>
);

const Check = () => (
  <svg className="w-4 h-4 text-red-600 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="m5 12 4 4L19 6" />
  </svg>
);

const Header = () => {
  const [open, setOpen] = useState(false);

  const closeMenu = () => setOpen(false);

  return (
    <>
      <div className="fixed top-0 left-0 right-0 z-50 bg-red-700 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 min-h-9 flex items-center justify-center text-center">
          <a href="#apply" className="text-xs sm:text-sm font-semibold tracking-wide hover:text-red-100 focus:outline-none focus:ring-2 focus:ring-white rounded">
            2027 admissions are now open <span className="hidden sm:inline">— begin your application online</span>
          </a>
        </div>
      </div>

      <header className="fixed top-9 left-0 right-0 z-50 bg-white/95 backdrop-blur border-b border-slate-100 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="h-16 md:h-[4.7rem] flex items-center justify-between">
            <a href="/" className="flex items-center gap-2.5 min-w-0" aria-label="Harmony Learning Institute home">
              <img src="/images/harmony-logo.png" alt="" className="w-11 h-11 md:w-12 md:h-12 object-contain shrink-0" />
              <span className="leading-tight">
                <span className="block font-extrabold text-[15px] sm:text-base text-blue-950 tracking-tight">Harmony Learning</span>
                <span className="block text-[10px] font-bold tracking-[0.16em] text-red-600 uppercase">Institute</span>
              </span>
            </a>

            <nav className="hidden lg:flex items-center gap-6 text-sm font-semibold text-slate-600" aria-label="Main navigation">
              <a href="#about" className="hover:text-red-700 transition-colors">Why Harmony</a>
              <a href="#programmes" className="hover:text-red-700 transition-colors">Programmes</a>
              <a href="#facilities" className="hover:text-red-700 transition-colors">Facilities</a>
              <a href="#school-life" className="hover:text-red-700 transition-colors">School Life</a>
              <a href="#apply" className="hover:text-red-700 transition-colors">Admissions</a>
            </nav>

            <div className="hidden md:flex items-center gap-3">
              <Link to="/parent/login" className="inline-flex items-center justify-center min-h-11 px-4 text-sm font-bold text-blue-950 border border-blue-950/15 rounded-lg hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-red-600">
                Parent Portal
              </Link>
              <a href="#apply" className="inline-flex items-center justify-center gap-1.5 min-h-11 px-5 text-sm font-bold text-white bg-red-700 rounded-lg shadow-sm hover:bg-red-800 focus:outline-none focus:ring-2 focus:ring-red-600 focus:ring-offset-2">
                Apply for 2027 <Arrow />
              </a>
            </div>

            <button
              type="button"
              className="md:hidden inline-flex items-center justify-center w-11 h-11 rounded-lg text-blue-950 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-red-600"
              aria-label={open ? 'Close navigation menu' : 'Open navigation menu'}
              aria-expanded={open}
              onClick={() => setOpen(!open)}
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                {open ? <path strokeLinecap="round" d="m6 6 12 12M18 6 6 18" /> : <path strokeLinecap="round" d="M4 7h16M4 12h16M4 17h16" />}
              </svg>
            </button>
          </div>

          {open && (
            <nav className="md:hidden py-3 border-t border-slate-100" aria-label="Mobile navigation">
              {[
                ['Why Harmony', '#about'],
                ['Programmes', '#programmes'],
                ['Facilities', '#facilities'],
                ['School Life', '#school-life'],
                ['Admissions', '#apply'],
              ].map(([label, href]) => (
                <a key={href} href={href} onClick={closeMenu} className="block px-3 py-3 text-sm font-bold text-slate-700 hover:bg-red-50 hover:text-red-700 rounded-lg">
                  {label}
                </a>
              ))}
              <div className="grid grid-cols-2 gap-3 pt-3 px-1">
                <Link to="/parent/login" onClick={closeMenu} className="inline-flex justify-center items-center min-h-11 text-sm font-bold text-blue-950 border border-blue-950/15 rounded-lg">
                  Parent Portal
                </Link>
                <a href="#apply" onClick={closeMenu} className="inline-flex justify-center items-center min-h-11 text-sm font-bold text-white bg-red-700 rounded-lg">
                  Apply now
                </a>
              </div>
            </nav>
          )}
        </div>
      </header>
    </>
  );
};

const Hero = () => (
  <section className="relative overflow-hidden bg-blue-950 pt-[6.5rem] md:pt-[7.4rem]">
    <div className="absolute inset-0">
      <img src={`${HOME_IMAGE}learner-group.webp`} alt="Harmony learners in uniform on campus" className="w-full h-full object-cover object-center" />
      <div className="absolute inset-0 bg-gradient-to-r from-blue-950 via-blue-950/85 to-blue-950/30" />
      <div className="absolute inset-0 bg-gradient-to-t from-blue-950/70 via-transparent to-transparent" />
    </div>
    <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-28 lg:py-36">
      <div className="max-w-2xl">
        <p className="inline-flex items-center gap-2 rounded-full bg-white/12 border border-white/20 px-3.5 py-2 text-xs sm:text-sm font-bold tracking-wide text-white mb-6">
          <span className="w-2 h-2 rounded-full bg-red-400" />
          Welcoming applications for 2027
        </p>
        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight leading-[1.06] text-white">
          A place to learn,<br />
          <span className="text-red-300">grow and belong.</span>
        </h1>
        <p className="mt-6 max-w-xl text-lg sm:text-xl leading-relaxed text-slate-100">
          Harmony Learning Institute is a caring learning community in Lephalale where every learner matters and every learner achieves.
        </p>
        <div className="mt-8 flex flex-col sm:flex-row gap-3">
          <a href="#apply" className="inline-flex items-center justify-center gap-2 min-h-14 px-6 text-base font-extrabold text-white bg-red-700 rounded-lg shadow-lg hover:bg-red-800 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-blue-950">
            Start an application <Arrow />
          </a>
          <a href="#about" className="inline-flex items-center justify-center min-h-14 px-6 text-base font-extrabold text-white border border-white/35 rounded-lg hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white">
            Discover Harmony
          </a>
        </div>
      </div>
    </div>
  </section>
);

const TrustStrip = () => (
  <section className="relative z-10 bg-white border-b border-slate-200">
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
        {[
          ['Learning journey', 'Preschool to Grade 7'],
          ['A place to thrive', 'A caring, inclusive community'],
          ['Located in Lephalale', 'Onverwacht, Limpopo'],
        ].map(([eyebrow, label]) => (
          <div key={eyebrow} className="py-5 sm:py-6 text-center">
            <p className="text-xs font-extrabold tracking-[0.14em] uppercase text-red-700">{eyebrow}</p>
            <p className="mt-1 font-bold text-blue-950">{label}</p>
          </div>
        ))}
      </div>
    </div>
  </section>
);

const SectionHeading = ({ eyebrow, title, copy, centered = false }) => (
  <div className={`${centered ? 'text-center mx-auto' : ''} max-w-2xl`}>
    <p className="text-xs font-extrabold tracking-[0.16em] uppercase text-red-700">{eyebrow}</p>
    <h2 className="mt-3 text-3xl sm:text-4xl font-black tracking-tight text-blue-950 leading-tight">{title}</h2>
    {copy && <p className="mt-4 text-base sm:text-lg leading-relaxed text-slate-600">{copy}</p>}
  </div>
);

const About = () => (
  <section id="about" className="py-20 sm:py-28 bg-slate-50">
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid lg:grid-cols-2 gap-12 lg:gap-20 items-center">
      <div className="relative order-2 lg:order-1">
        <div className="grid grid-cols-5 gap-3">
          <img src={`${HOME_IMAGE}staff-team.webp`} alt="Harmony Learning Institute teaching team" loading="lazy" className="col-span-5 rounded-2xl object-cover aspect-[2.45/1] shadow-xl" />
          <img src={`${HOME_IMAGE}campus-gate.webp`} alt="Harmony Learning Institute campus entrance" loading="lazy" className="col-span-3 rounded-2xl object-cover aspect-[1.35/1] shadow-lg" />
          <div className="col-span-2 rounded-2xl bg-red-700 p-5 sm:p-6 text-white flex flex-col justify-end shadow-lg">
            <p className="text-xs font-extrabold tracking-[0.14em] uppercase text-red-100">Our vision</p>
            <p className="mt-3 text-lg sm:text-xl font-extrabold leading-snug">Every learner matters. Every learner achieves.</p>
          </div>
        </div>
      </div>
      <div className="order-1 lg:order-2">
        <SectionHeading eyebrow="Why Harmony" title="A school community that sees every learner." copy="We create a welcoming environment where learners are encouraged to develop their strengths, build confidence and take pride in their progress." />
        <div className="mt-8 grid gap-4">
          {[
            ['A nurturing start', 'Thoughtful support for young learners as they begin their school journey.'],
            ['Learning with purpose', 'An inclusive and progressive approach to education.'],
            ['Community and belonging', 'A school culture that celebrates learners, families and South African heritage.'],
          ].map(([title, detail]) => (
            <div key={title} className="flex gap-3.5 bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
              <span className="mt-0.5 w-7 h-7 inline-flex items-center justify-center rounded-full bg-red-50"><Check /></span>
              <div>
                <h3 className="font-extrabold text-blue-950">{title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-slate-600">{detail}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  </section>
);

const Programmes = () => {
  const programmes = [
    {
      name: 'Preschool',
      level: 'Ages 0–6',
      image: 'young-learners.webp',
      copy: 'A warm foundation for play, discovery, creativity and early learning.',
      points: ['Play-based learning', 'Creative development', 'Social skills'],
    },
    {
      name: 'Primary School',
      level: 'Grades 1–7',
      image: 'learner-group.webp',
      copy: 'A supportive primary-school journey with learning, character and community at its heart.',
      points: ['Core learning', 'Computer literacy', 'Sports and arts'],
    },
    {
      name: 'Boarding',
      level: 'Available option',
      image: 'campus-classrooms.webp',
      copy: 'A structured home-away-from-home option for families who need it.',
      points: ['Supervised environment', 'Study support', 'Community living'],
    },
  ];
  return (
    <section id="programmes" className="py-20 sm:py-28 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <SectionHeading centered eyebrow="Programmes" title="A learning journey with room to grow." copy="From early childhood through primary school, Harmony supports learners at every stage." />
        <div className="mt-12 grid md:grid-cols-3 gap-6 lg:gap-8">
          {programmes.map((programme) => (
            <article key={programme.name} className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm hover:shadow-xl transition-shadow">
              <img src={`${HOME_IMAGE}${programme.image}`} alt={`${programme.name} learners at Harmony Learning Institute`} loading="lazy" className="w-full h-56 object-cover group-hover:scale-[1.03] transition-transform duration-500" />
              <div className="p-6">
                <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-red-700">{programme.level}</p>
                <h3 className="mt-2 text-2xl font-black text-blue-950">{programme.name}</h3>
                <p className="mt-3 text-sm leading-relaxed text-slate-600">{programme.copy}</p>
                <ul className="mt-5 space-y-2">
                  {programme.points.map((point) => <li key={point} className="flex gap-2 text-sm font-semibold text-slate-700"><Check />{point}</li>)}
                </ul>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
};

const Facilities = () => (
  <section id="facilities" className="py-20 sm:py-28 bg-blue-950 text-white overflow-hidden">
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div className="grid lg:grid-cols-[0.9fr_1.1fr] gap-12 lg:gap-20 items-center">
        <div>
          <p className="text-xs font-extrabold tracking-[0.16em] uppercase text-red-300">Campus facilities</p>
          <h2 className="mt-3 text-3xl sm:text-4xl font-black leading-tight">Space for learning, creating and moving.</h2>
          <p className="mt-5 text-lg leading-relaxed text-blue-100">Our campus gives learners room for focused classroom learning, technology and active school life.</p>
          <a href="#apply" className="mt-8 inline-flex items-center gap-2 min-h-12 px-5 rounded-lg bg-white text-blue-950 font-extrabold hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-white">
            Apply for 2027 <Arrow />
          </a>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:gap-4">
          <figure className="col-span-2 relative overflow-hidden rounded-2xl aspect-[2/1]">
            <img src={`${HOME_IMAGE}classroom.webp`} alt="A prepared Harmony classroom" loading="lazy" className="w-full h-full object-cover" />
            <figcaption className="absolute left-4 bottom-4 px-3 py-1.5 bg-blue-950/90 rounded text-sm font-bold">Classrooms</figcaption>
          </figure>
          <figure className="relative overflow-hidden rounded-2xl aspect-square">
            <img src={`${HOME_IMAGE}computer-lab.webp`} alt="Harmony computer lab" loading="lazy" className="w-full h-full object-cover" />
            <figcaption className="absolute left-3 bottom-3 px-2.5 py-1 bg-blue-950/90 rounded text-xs sm:text-sm font-bold">Computer lab</figcaption>
          </figure>
          <figure className="relative overflow-hidden rounded-2xl aspect-square">
            <img src={`${HOME_IMAGE}sports-court.webp`} alt="Harmony covered sports court" loading="lazy" className="w-full h-full object-cover" />
            <figcaption className="absolute left-3 bottom-3 px-2.5 py-1 bg-blue-950/90 rounded text-xs sm:text-sm font-bold">Sports court</figcaption>
          </figure>
        </div>
      </div>
    </div>
  </section>
);

const SchoolLife = () => {
  const photos = [
    ['sports-team.webp', 'Harmony learners taking part in a sports day', 'md:col-span-2 md:row-span-2'],
    ['learners-community.webp', 'Harmony learners in school uniform', ''],
    ['young-learners.webp', 'Young Harmony learners together', ''],
    ['campus-classrooms.webp', 'Harmony classrooms on campus', 'md:col-span-2'],
  ];
  return (
    <section id="school-life" className="py-20 sm:py-28 bg-slate-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-5">
          <SectionHeading eyebrow="Life at Harmony" title="Learning is only part of the story." copy="School life is made of friendships, shared achievements, active days and moments that help learners feel at home." />
          <a href="#apply" className="inline-flex self-start lg:self-auto items-center gap-2 text-sm font-extrabold text-red-700 hover:text-red-900">Join the Harmony community <Arrow /></a>
        </div>
        <div className="mt-10 grid grid-cols-2 md:grid-cols-4 md:grid-rows-2 gap-3 sm:gap-4 h-[31rem] sm:h-[37rem]">
          {photos.map(([image, alt, span]) => (
            <figure key={image} className={`relative overflow-hidden rounded-2xl ${span}`}>
              <img src={`${HOME_IMAGE}${image}`} alt={alt} loading="lazy" className="w-full h-full object-cover hover:scale-105 transition-transform duration-700" />
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
};

const ParentPortal = () => (
  <section className="py-16 sm:py-20 bg-white">
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
      <div className="rounded-3xl bg-red-700 overflow-hidden grid lg:grid-cols-[1fr_0.8fr] shadow-xl">
        <div className="p-8 sm:p-12 text-white">
          <p className="text-xs font-extrabold tracking-[0.16em] uppercase text-red-100">For Harmony parents</p>
          <h2 className="mt-3 text-3xl sm:text-4xl font-black leading-tight">Stay connected to your child’s learning.</h2>
          <p className="mt-4 text-red-50 leading-relaxed max-w-xl">Use the Parent Portal to access your existing Harmony account securely.</p>
          <Link to="/parent/login" className="mt-7 inline-flex items-center justify-center gap-2 min-h-12 px-5 rounded-lg bg-white text-red-700 font-extrabold hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-white">
            Open Parent Portal <Arrow />
          </Link>
        </div>
        <div className="hidden lg:flex relative bg-blue-950 p-10 items-center justify-center">
          <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_top_right,_#ffffff_0,_transparent_40%)]" />
          <div className="relative w-full max-w-xs rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-center gap-3 pb-4 border-b border-slate-100">
              <img src="/images/harmony-logo.png" alt="" className="w-10 h-10 object-contain" />
              <div><p className="font-extrabold text-blue-950 text-sm">Parent Portal</p><p className="text-xs text-slate-500">Harmony Learning Institute</p></div>
            </div>
            <div className="mt-5 space-y-3">
              <div className="h-9 rounded bg-slate-100" />
              <div className="h-9 rounded bg-slate-100" />
              <div className="h-10 rounded bg-red-700" />
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
);

const EnrollmentSection = () => {
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const { register, handleSubmit, formState: { errors }, reset } = useForm();

  const grades = [
    { value: 'preschool-0', label: 'Preschool (Age 0)' }, { value: 'preschool-1', label: 'Preschool (Age 1)' },
    { value: 'preschool-2', label: 'Preschool (Age 2)' }, { value: 'preschool-3', label: 'Preschool (Age 3)' },
    { value: 'preschool-4', label: 'Preschool (Age 4)' }, { value: 'preschool-5', label: 'Preschool (Age 5)' },
    { value: 'preschool-6', label: 'Preschool (Age 6)' }, { value: 'grade-1', label: 'Grade 1' },
    { value: 'grade-2', label: 'Grade 2' }, { value: 'grade-3', label: 'Grade 3' },
    { value: 'grade-4', label: 'Grade 4' }, { value: 'grade-5', label: 'Grade 5' },
    { value: 'grade-6', label: 'Grade 6' }, { value: 'grade-7', label: 'Grade 7' },
  ];

  const onSubmit = async (data) => {
    setLoading(true);
    try {
      const response = await fetch('/api/enrollments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
          additionalNotes: data.additionalNotes,
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (result.errors && result.errors.length > 0) throw new Error(result.errors.map((error) => error.msg).join('. '));
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
      <section id="apply" className="py-20 sm:py-28 bg-slate-50">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="bg-white rounded-3xl shadow-lg border border-slate-100 p-8 sm:p-12 text-center">
            <div className="w-14 h-14 rounded-full mx-auto bg-emerald-100 flex items-center justify-center">
              <svg className="w-7 h-7 text-emerald-700" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="m5 12 4 4L19 6" /></svg>
            </div>
            <p className="mt-5 text-xs font-extrabold tracking-[0.16em] uppercase text-red-700">Application received</p>
            <h2 className="mt-3 text-3xl font-black text-blue-950">Thank you for choosing Harmony.</h2>
            <p className="mt-4 text-slate-600 text-lg">Our admissions team will review your application and contact you within 48 hours.</p>
            <button type="button" onClick={() => setSubmitted(false)} className="mt-8 min-h-12 px-5 rounded-lg bg-red-700 text-white font-extrabold hover:bg-red-800 focus:outline-none focus:ring-2 focus:ring-red-700 focus:ring-offset-2">
              Submit another application
            </button>
          </div>
        </div>
      </section>
    );
  }

  const inputClass = 'mt-1.5 w-full min-h-12 px-3.5 border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-red-600 focus:border-transparent';
  return (
    <section id="apply" className="py-20 sm:py-28 bg-slate-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid lg:grid-cols-[0.75fr_1.25fr] gap-10 lg:gap-16 items-start">
        <div className="lg:sticky lg:top-32">
          <SectionHeading eyebrow="2027 admissions" title="Take the next step with Harmony." copy="Complete the online application below and our admissions team will contact you to discuss the next steps." />
          <div className="mt-8 bg-blue-950 rounded-2xl p-6 text-white">
            <p className="font-extrabold">What you’ll need</p>
            <ul className="mt-4 space-y-3 text-sm text-blue-100">
              <li className="flex gap-2"><Check /><span>Parent or guardian contact details</span></li>
              <li className="flex gap-2"><Check /><span>Learner details and date of birth</span></li>
              <li className="flex gap-2"><Check /><span>The grade you are applying for</span></li>
            </ul>
          </div>
          <p className="mt-6 text-sm leading-relaxed text-slate-600">Already a Harmony parent? <Link to="/parent/login" className="font-extrabold text-red-700 hover:text-red-900">Open the Parent Portal.</Link></p>
        </div>
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-5 sm:p-8 lg:p-10">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-7">
            <fieldset>
              <legend className="text-xl font-black text-blue-950">Parent or guardian</legend>
              <div className="mt-5 grid sm:grid-cols-2 gap-5">
                <Field label="First name" error={errors.parentFirstName}><input type="text" {...register('parentFirstName', { required: 'First name is required' })} className={inputClass} autoComplete="given-name" /></Field>
                <Field label="Last name" error={errors.parentLastName}><input type="text" {...register('parentLastName', { required: 'Last name is required' })} className={inputClass} autoComplete="family-name" /></Field>
                <Field label="Email address" error={errors.parentEmail}><input type="email" {...register('parentEmail', { required: 'Email is required', pattern: { value: /^\S+@\S+$/i, message: 'Enter a valid email address' } })} className={inputClass} autoComplete="email" /></Field>
                <Field label="Phone number" error={errors.parentPhone}><input type="tel" {...register('parentPhone', { required: 'Phone number is required' })} className={inputClass} autoComplete="tel" /></Field>
              </div>
            </fieldset>
            <fieldset className="pt-7 border-t border-slate-200">
              <legend className="text-xl font-black text-blue-950">Learner details</legend>
              <div className="mt-5 grid sm:grid-cols-2 gap-5">
                <Field label="First name" error={errors.studentFirstName}><input type="text" {...register('studentFirstName', { required: 'Student first name is required' })} className={inputClass} /></Field>
                <Field label="Last name" error={errors.studentLastName}><input type="text" {...register('studentLastName', { required: 'Student last name is required' })} className={inputClass} /></Field>
                <Field label="Date of birth" error={errors.studentDateOfBirth}><input type="date" {...register('studentDateOfBirth', { required: 'Date of birth is required' })} className={inputClass} /></Field>
                <Field label="Grade applying for" error={errors.gradeApplying}>
                  <select {...register('gradeApplying', { required: 'Please select a grade' })} className={inputClass}><option value="">Select a grade</option>{grades.map((grade) => <option key={grade.value} value={grade.value}>{grade.label}</option>)}</select>
                </Field>
              </div>
            </fieldset>
            <label className="flex items-start gap-3 p-4 bg-red-50 rounded-xl cursor-pointer">
              <input type="checkbox" {...register('boardingOption')} className="mt-0.5 w-5 h-5 accent-red-700" />
              <span><span className="block font-extrabold text-blue-950">Interested in boarding?</span><span className="block mt-1 text-sm text-slate-600">Let us know if you would like to explore the boarding option.</span></span>
            </label>
            <div className="grid sm:grid-cols-2 gap-5">
              <Field label="Previous school (if any)" optional><input type="text" {...register('previousSchool')} className={inputClass} /></Field>
              <Field label="Additional notes" optional><textarea {...register('additionalNotes')} rows={2} className={`${inputClass} py-3 resize-y`} /></Field>
            </div>
            <button type="submit" disabled={loading} className="w-full min-h-14 inline-flex items-center justify-center gap-2 rounded-lg bg-red-700 text-white font-extrabold hover:bg-red-800 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-red-700 focus:ring-offset-2">
              {loading ? 'Submitting application…' : <>Submit application <Arrow /></>}
            </button>
            <p className="text-center text-xs text-slate-500">We will contact you within 48 hours after your application is received.</p>
          </form>
        </div>
      </div>
    </section>
  );
};

const Field = ({ label, error, children, optional = false }) => (
  <label className="block text-sm font-bold text-slate-700">
    {label} {!optional && <span className="text-red-700">*</span>}
    {children}
    {error && <span className="block mt-1 text-xs font-semibold text-red-700">{error.message}</span>}
  </label>
);

const Footer = () => (
  <footer className="bg-blue-950 text-white">
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14 grid md:grid-cols-[1.3fr_0.7fr_1fr] gap-10">
      <div>
        <div className="flex items-center gap-3">
          <img src="/images/harmony-logo.png" alt="Harmony Learning Institute" className="w-14 h-14 bg-white rounded-full object-contain" />
          <div><p className="font-extrabold text-lg">Harmony Learning</p><p className="text-sm text-red-300 font-bold">Institute</p></div>
        </div>
        <p className="mt-5 max-w-sm text-sm leading-relaxed text-blue-100">An exceptional school; inclusive and progressive, where every learner matters and every learner achieves.</p>
      </div>
      <div>
        <h2 className="text-sm font-extrabold tracking-[0.14em] uppercase text-red-300">Explore</h2>
        <ul className="mt-4 space-y-3 text-sm text-blue-100">
          <li><a href="#about" className="hover:text-white">Why Harmony</a></li>
          <li><a href="#programmes" className="hover:text-white">Programmes</a></li>
          <li><a href="#facilities" className="hover:text-white">Facilities</a></li>
          <li><a href="#apply" className="hover:text-white">2027 admissions</a></li>
          <li><Link to="/parent/login" className="hover:text-white">Parent Portal</Link></li>
          <li><Link to="/login?type=student" className="hover:text-white">Student Portal</Link></li>
          <li><Link to="/login" className="hover:text-white">Staff login</Link></li>
        </ul>
      </div>
      <address className="not-italic">
        <h2 className="text-sm font-extrabold tracking-[0.14em] uppercase text-red-300">Contact</h2>
        <div className="mt-4 space-y-3 text-sm leading-relaxed text-blue-100">
          <p>2 Skilferdoring Street<br />Onverwacht, Lephalale</p>
          <p><a href="tel:+27147631358" className="hover:text-white">014 763 1358</a></p>
          <p><a href="mailto:harmonylearninginstitute@gmail.com" className="hover:text-white break-words">harmonylearninginstitute@gmail.com</a></p>
          <p><a href="https://wa.me/27711679620" target="_blank" rel="noopener noreferrer" className="font-extrabold text-white hover:text-red-200">Chat on WhatsApp</a></p>
        </div>
      </address>
    </div>
    <div className="border-t border-white/10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex flex-col sm:flex-row gap-2 items-center justify-between text-xs text-blue-200">
        <p>© {new Date().getFullYear()} Harmony Learning Institute. All rights reserved.</p>
        <a href="https://auto-m8.co.za/" target="_blank" rel="noopener noreferrer" className="hover:text-white">Powered by AutoM8</a>
      </div>
    </div>
  </footer>
);

const WhatsAppButton = () => (
  <a href="https://wa.me/27711679620" target="_blank" rel="noopener noreferrer" aria-label="Chat with Harmony Learning Institute on WhatsApp" className="fixed bottom-5 right-5 z-40 w-14 h-14 rounded-full bg-green-600 text-white shadow-lg hover:bg-green-700 hover:scale-105 focus:outline-none focus:ring-2 focus:ring-green-600 focus:ring-offset-2 transition flex items-center justify-center">
    <svg className="w-7 h-7" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884" /></svg>
  </a>
);

const LandingPage = () => (
  <div className="min-h-screen scroll-smooth bg-white">
    <Header />
    <main>
      <Hero />
      <TrustStrip />
      <About />
      <Programmes />
      <Facilities />
      <SchoolLife />
      <ParentPortal />
      <EnrollmentSection />
    </main>
    <Footer />
    <WhatsAppButton />
  </div>
);

export default LandingPage;