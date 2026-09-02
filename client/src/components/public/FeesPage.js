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

const CheckList = ({ items }) => (
  <ul className="mt-4 space-y-3 text-sm leading-relaxed text-slate-700">
    {items.map((item) => (
      <li key={item} className="flex gap-3">
        <span className="font-black text-red-700" aria-hidden="true">✓</span>
        <span>{item}</span>
      </li>
    ))}
  </ul>
);

const FeeCard = ({ eyebrow, amount, detail }) => (
  <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
    <p className="text-xs font-extrabold tracking-[0.14em] uppercase text-red-700">{eyebrow}</p>
    <p className="mt-3 text-3xl font-black tracking-tight text-blue-950">{amount}</p>
    <p className="mt-2 text-sm leading-relaxed text-slate-600">{detail}</p>
  </article>
);

const FeesPage = () => {
  const { learnerCategories, monthly, discounts, admissionRequirements, banking } = FEE_STRUCTURE_2027;

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
            <p className="text-xs font-extrabold tracking-[0.16em] uppercase text-red-300">Admissions 2027 are open</p>
            <h1 className="mt-3 max-w-3xl text-4xl font-black tracking-tight text-white sm:text-5xl">2027 School Fees</h1>
            <p className="mt-5 max-w-2xl text-lg leading-relaxed text-blue-100">Clear, verified information to help families plan for the 2027 school year.</p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <a href="#estimator" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-red-700 px-5 font-extrabold text-white hover:bg-red-800 focus:outline-none focus:ring-2 focus:ring-white">Estimate your fees <Arrow /></a>
              <Link to="/#apply" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-white/35 px-5 font-extrabold text-white hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white">Start an application <Arrow /></Link>
            </div>
          </div>
        </section>

        <section className="py-14 sm:py-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div>
              <p className="text-xs font-extrabold tracking-[0.16em] uppercase text-red-700">Early Learning</p>
              <h2 className="mt-2 text-3xl font-black text-blue-950">Baby Class through Grade R</h2>
              <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {Object.entries(learnerCategories).filter(([, category]) => category.group === 'Early Learning').map(([key, category]) => (
                  <FeeCard key={key} eyebrow={category.shortLabel} amount={`${formatRand(category.monthlyTuition)} / month`} detail="Monthly school fee, payable January to December." />
                ))}
              </div>
            </div>

            <div className="mt-12">
              <p className="text-xs font-extrabold tracking-[0.16em] uppercase text-red-700">Primary School</p>
              <h2 className="mt-2 text-3xl font-black text-blue-950">Grades 1–7</h2>
              <div className="mt-6 max-w-xl">
                <FeeCard eyebrow="Grades 1–7" amount={`${formatRand(learnerCategories['grades-1-7'].monthlyTuition)} / month`} detail="Monthly school fee, payable January to December." />
              </div>
            </div>

            <div className="mt-12 grid gap-6 lg:grid-cols-2">
              <div className="rounded-2xl bg-blue-950 p-6 text-white sm:p-8">
                <p className="text-xs font-extrabold tracking-[0.14em] uppercase text-red-300">Boarding</p>
                <h2 className="mt-3 text-2xl font-black">Inclusive monthly boarding fees</h2>
                <dl className="mt-5 space-y-3 text-blue-100">
                  <div className="flex justify-between gap-4"><dt>Baby Class–Grade R</dt><dd className="font-extrabold text-white">{formatRand(learnerCategories['grade-r'].monthlyBoarding)}</dd></div>
                  <div className="flex justify-between gap-4"><dt>Grades 1–7</dt><dd className="font-extrabold text-white">{formatRand(learnerCategories['grades-1-7'].monthlyBoarding)}</dd></div>
                </dl>
                <p className="mt-5 text-sm font-bold text-red-200">{FEE_STRUCTURE_2027.boardingSummary}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
                <p className="text-xs font-extrabold tracking-[0.14em] uppercase text-red-700">Transport</p>
                <h2 className="mt-3 text-2xl font-black text-blue-950">{formatRand(monthly.transport)} / month</h2>
                <p className="mt-4 text-slate-700">Transport is currently available only in:</p>
                <CheckList items={FEE_STRUCTURE_2027.transportRoutes.filter((route) => route.value !== 'none').map((route) => route.label)} />
              </div>
            </div>

            <div className="mt-12">
              <p className="text-xs font-extrabold tracking-[0.16em] uppercase text-red-700">Registration</p>
              <h2 className="mt-2 text-3xl font-black text-blue-950">Application and re-registration fees</h2>
              <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                <FeeCard eyebrow="New — Baby Class–Grade R" amount={formatRand(learnerCategories['grade-r'].newRegistration)} detail="Registration fee for a new applicant." />
                <FeeCard eyebrow="New — Grades 1–7" amount={formatRand(learnerCategories['grades-1-7'].newRegistration)} detail="Registration fee for a new applicant." />
                <FeeCard eyebrow="Returning — Grades 1–7" amount={formatRand(learnerCategories['grades-1-7'].reRegistration)} detail="Re-registration fee for returning learners in Grades 1–7." />
              </div>
              <p className="mt-4 text-sm text-slate-600">No Baby Class–Grade R re-registration amount has been published. Please confirm with Harmony.</p>
            </div>

            <div className="mt-12 grid gap-6 lg:grid-cols-2">
              <div className="rounded-2xl border border-red-100 bg-red-50 p-6 sm:p-8">
                <p className="text-xs font-extrabold tracking-[0.14em] uppercase text-red-700">Payment discounts</p>
                <h2 className="mt-3 text-2xl font-black text-blue-950">Plan for January–December</h2>
                <CheckList items={[
                  `Half-year upfront: ${discounts.halfYear}.`,
                  `Full-year upfront: ${discounts.fullYear}.`,
                ]} />
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
                <p className="text-xs font-extrabold tracking-[0.14em] uppercase text-red-700">Sibling discount</p>
                <h2 className="mt-3 text-2xl font-black text-blue-950">{formatRand(discounts.siblingAmount)} per learner</h2>
                <p className="mt-4 leading-relaxed text-slate-700">{discounts.sibling}</p>
                <p className="mt-5 text-sm font-bold text-blue-950">This discount is not automatically included in the estimator.</p>
              </div>
            </div>

            <div className="mt-6 rounded-2xl bg-white p-6 shadow-sm sm:p-8">
              <p className="text-xs font-extrabold tracking-[0.14em] uppercase text-red-700">Saturday Classes</p>
              <h2 className="mt-3 text-2xl font-black text-blue-950">Free for enrolled Harmony learners</h2>
              <p className="mt-3 text-slate-700">{FEE_STRUCTURE_2027.saturdayClasses}</p>
            </div>

            <div className="mt-12">
              <FeeEstimator />
            </div>

            <section className="mt-12 rounded-3xl bg-white p-7 shadow-sm sm:p-10" aria-labelledby="admission-requirements">
              <p className="text-xs font-extrabold tracking-[0.16em] uppercase text-red-700">Admission and boarding requirements</p>
              <h2 id="admission-requirements" className="mt-3 text-3xl font-black text-blue-950">2027 admissions checklist</h2>
              <div className="mt-7 grid gap-8 lg:grid-cols-2">
                <div>
                  <h3 className="text-lg font-black text-blue-950">Baby Class through Grade 7</h3>
                  <CheckList items={admissionRequirements.allLearners} />
                </div>
                <div>
                  <h3 className="text-lg font-black text-blue-950">Grades 1–7 additionally</h3>
                  <CheckList items={admissionRequirements.grades1to7Additional} />
                </div>
              </div>
              <p className="mt-6 text-sm text-slate-600">The same verified document checklist applies to boarding applications.</p>
            </section>

            <section className="mt-12 rounded-3xl bg-blue-950 p-7 text-white sm:p-10" aria-labelledby="banking-details">
              <p className="text-xs font-extrabold tracking-[0.16em] uppercase text-red-300">Banking details</p>
              <h2 id="banking-details" className="mt-3 text-3xl font-black">Harmony Learning Institute</h2>
              <dl className="mt-7 grid gap-4 sm:grid-cols-2">
                {[
                  ['Bank', banking.bank],
                  ['Account holder', banking.accountHolder],
                  ['Account number', banking.accountNumber],
                  ['Branch code', banking.branchCode],
                  ['Payment reference', banking.reference],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl bg-white/10 p-4">
                    <dt className="text-xs font-bold uppercase tracking-wide text-blue-200">{label}</dt>
                    <dd className="mt-1 font-extrabold">{value}</dd>
                  </div>
                ))}
              </dl>
            </section>

            <div className="mt-10 rounded-3xl bg-white p-7 text-center shadow-sm sm:p-10">
              <p className="text-xs font-extrabold tracking-[0.16em] uppercase text-red-700">Ready to join Harmony?</p>
              <h2 className="mt-3 text-3xl font-black text-blue-950">2027 admissions are open.</h2>
              <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
                <Link to="/#apply" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-red-700 px-5 font-extrabold text-white hover:bg-red-800 focus:outline-none focus:ring-2 focus:ring-red-700">Start Your Application <Arrow /></Link>
                <a href="mailto:harmonylearninginstitute@gmail.com" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-slate-200 px-5 font-extrabold text-blue-950 hover:border-red-200 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-700">Contact Admissions <Arrow /></a>
                <a href="https://wa.me/27711679620" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-slate-200 px-5 font-extrabold text-blue-950 hover:border-red-200 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-700">Ask Us on WhatsApp</a>
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