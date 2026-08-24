import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Footer, Header, WhatsAppButton } from './LandingPage';
import FeeEstimator from './FeeEstimator';
import HashScroll from './HashScroll';
import { FEE_STRUCTURE_2027, formatRand } from '../../data/fees2027';

const Arrow = () => (
  <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
  </svg>
);

const FeeCard = ({ eyebrow, amount, detail }) => (
  <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
    <p className="text-xs font-extrabold tracking-[0.14em] uppercase text-red-700">{eyebrow}</p>
    <p className="mt-3 text-3xl font-black tracking-tight text-blue-950">{amount}</p>
    <p className="mt-2 text-sm leading-relaxed text-slate-600">{detail}</p>
  </article>
);

const FeesPage = () => {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = '2027 School Fees | Harmony Learning Institute';
    return () => { document.title = previousTitle; };
  }, []);

  return (
    <div className="min-h-screen bg-slate-50">
      <Header />
      <HashScroll />
      <main className="pt-[6.5rem] md:pt-[7.4rem]">
        <section className="relative overflow-hidden bg-blue-950 py-16 sm:py-20">
          <div className="absolute inset-0 opacity-25">
            <img src="/images/school/harmony-campus.webp" alt="" className="h-full w-full object-cover" />
          </div>
          <div className="absolute inset-0 bg-gradient-to-r from-blue-950 via-blue-950/95 to-blue-950/65" />
          <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <p className="text-xs font-extrabold tracking-[0.16em] uppercase text-red-300">Admissions 2027</p>
            <h1 className="mt-3 max-w-3xl text-4xl font-black tracking-tight text-white sm:text-5xl">2027 School Fees</h1>
            <p className="mt-5 max-w-2xl text-lg leading-relaxed text-blue-100">Clear, straightforward information to help families plan for the 2027 school year.</p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <a href="#estimator" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-red-700 px-5 font-extrabold text-white hover:bg-red-800 focus:outline-none focus:ring-2 focus:ring-white">
                Estimate your fees <Arrow />
              </a>
              <Link to="/#apply" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-white/35 px-5 font-extrabold text-white hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white">
                Start an application <Arrow />
              </Link>
            </div>
          </div>
        </section>

        <section className="py-14 sm:py-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              <FeeCard eyebrow="Grade R" amount={`${formatRand(FEE_STRUCTURE_2027.monthly.gradeR)} / month`} detail="Published monthly school fee for 2027." />
              <FeeCard eyebrow="Grades 1–7" amount={`${formatRand(FEE_STRUCTURE_2027.monthly.grades1to7)} / month`} detail="Published monthly school fee for 2027." />
              <FeeCard eyebrow="Boarding — Grade R category" amount={`${formatRand(FEE_STRUCTURE_2027.monthly.boardingGradeRCategory)} / month`} detail="School fees included." />
              <FeeCard eyebrow="Boarding — Grades 1–7" amount={`${formatRand(FEE_STRUCTURE_2027.monthly.boardingGrades1to7)} / month`} detail="School fees included." />
              <FeeCard eyebrow="Aftercare" amount={`${formatRand(FEE_STRUCTURE_2027.monthly.aftercare)} / month`} detail="Added monthly when selected." />
              <FeeCard eyebrow="New learner registration" amount={`${formatRand(FEE_STRUCTURE_2027.onceOff.newRegistration)} once-off`} detail="Non-refundable." />
              <FeeCard eyebrow="Re-registration" amount={formatRand(FEE_STRUCTURE_2027.onceOff.reRegistration)} detail="For learners who are already registered." />
            </div>

            <div className="mt-8 grid gap-6 lg:grid-cols-2">
              <div className="rounded-2xl bg-blue-950 p-6 text-white sm:p-8">
                <p className="text-xs font-extrabold tracking-[0.14em] uppercase text-red-300">Payment information</p>
                <h2 className="mt-3 text-2xl font-black">Plan for the full school year.</h2>
                <p className="mt-4 text-blue-100">School fees are payable over 12 months from {FEE_STRUCTURE_2027.paymentPeriod}.</p>
                <ul className="mt-5 space-y-3 text-sm text-blue-100">
                  {FEE_STRUCTURE_2027.paymentMethods.map((method) => <li key={method} className="flex gap-2"><span className="text-red-300">✓</span><span>{method}</span></li>)}
                </ul>
              </div>
              <div className="rounded-2xl border border-red-100 bg-red-50 p-6 sm:p-8">
                <p className="text-xs font-extrabold tracking-[0.14em] uppercase text-red-700">Annual payment benefit</p>
                <h2 className="mt-3 text-2xl font-black text-blue-950">Pay annually in advance.</h2>
                <p className="mt-4 leading-relaxed text-slate-700">Pay annually in advance and qualify for a one-month fee discount. Contact the school for your confirmed annual amount.</p>
                <p className="mt-5 text-sm font-semibold text-slate-600">Transport pricing depends on route and availability. Contact Harmony for a quotation.</p>
              </div>
            </div>

            <div className="mt-10">
              <FeeEstimator />
            </div>

            <div className="mt-10 rounded-3xl bg-white p-7 text-center shadow-sm sm:p-10">
              <p className="text-xs font-extrabold tracking-[0.16em] uppercase text-red-700">Ready to join Harmony?</p>
              <h2 className="mt-3 text-3xl font-black text-blue-950">Take the next step with confidence.</h2>
              <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
                <Link to="/#apply" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-red-700 px-5 font-extrabold text-white hover:bg-red-800 focus:outline-none focus:ring-2 focus:ring-red-700">
                  Start Your Application <Arrow />
                </Link>
                <a href="mailto:harmonylearninginstitute@gmail.com" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-slate-200 px-5 font-extrabold text-blue-950 hover:border-red-200 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-700">
                  Contact Admissions <Arrow />
                </a>
                <a href="https://wa.me/27711679620" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-slate-200 px-5 font-extrabold text-blue-950 hover:border-red-200 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-700">
                  Ask Us on WhatsApp
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>
      <Footer />
      <WhatsAppButton />
    </div>
  );
};

export default FeesPage;