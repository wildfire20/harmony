import React, { useState } from 'react';
import { FEE_STRUCTURE_2027, calculateFeeEstimate, formatRand } from '../../data/fees2027';

const OptionGroup = ({ legend, name, value, onChange, options }) => (
  <fieldset>
    <legend className="text-sm font-extrabold text-blue-950">{legend}</legend>
    <div className="mt-3 grid gap-2">
      {options.map((option) => (
        <label key={option.value} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors ${value === option.value ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-white hover:border-red-200'}`}>
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={(event) => onChange(event.target.value)}
            className="h-4 w-4 accent-red-700"
          />
          <span className="text-sm font-semibold text-slate-700">{option.label}</span>
        </label>
      ))}
    </div>
  </fieldset>
);

const FeeEstimator = () => {
  const [selections, setSelections] = useState({
    learnerCategory: 'grade-r',
    boarding: 'no',
    aftercare: 'no',
    applicant: 'new',
    transport: 'not-required',
  });
  const estimate = calculateFeeEstimate(selections);

  const update = (field) => (value) => setSelections((current) => ({ ...current, [field]: value }));

  return (
    <section id="estimator" className="scroll-mt-28 rounded-3xl bg-slate-50 p-5 sm:p-8 lg:p-10">
      <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-14">
        <div>
          <p className="text-xs font-extrabold tracking-[0.16em] uppercase text-red-700">Plan ahead</p>
          <h2 className="mt-3 text-3xl font-black tracking-tight text-blue-950">Estimate Your 2027 Fees</h2>
          <p className="mt-4 text-base leading-relaxed text-slate-600">
            Choose the options that best describe your plans. This is an estimator, not an invoice.
          </p>
          <div className="mt-7 grid gap-6">
            <OptionGroup
              legend="Learner category"
              name="learnerCategory"
              value={selections.learnerCategory}
              onChange={update('learnerCategory')}
              options={[
                { value: 'grade-r', label: 'Grade R' },
                { value: 'grades-1-7', label: 'Grades 1–7' },
              ]}
            />
            <OptionGroup
              legend="Boarding"
              name="boarding"
              value={selections.boarding}
              onChange={update('boarding')}
              options={[{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }]}
            />
            <OptionGroup
              legend="Aftercare"
              name="aftercare"
              value={selections.aftercare}
              onChange={update('aftercare')}
              options={[{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }]}
            />
            <OptionGroup
              legend="Applicant"
              name="applicant"
              value={selections.applicant}
              onChange={update('applicant')}
              options={[{ value: 'new', label: 'New learner' }, { value: 'returning', label: 'Returning learner' }]}
            />
            <OptionGroup
              legend="Transport"
              name="transport"
              value={selections.transport}
              onChange={update('transport')}
              options={[{ value: 'interested', label: 'Interested' }, { value: 'not-required', label: 'Not required' }]}
            />
          </div>
        </div>

        <div className="self-start rounded-2xl bg-blue-950 p-6 text-white shadow-lg sm:p-8">
          <p className="text-xs font-extrabold tracking-[0.16em] uppercase text-red-300">Your estimate</p>
          <h3 className="mt-3 text-2xl font-black">Estimated Monthly Fees</h3>
          <dl className="mt-7 divide-y divide-white/15">
            <div className="flex items-start justify-between gap-4 py-4">
              <dt className="text-blue-100">Tuition / Boarding</dt>
              <dd className="font-extrabold tabular-nums">{formatRand(estimate.tuitionOrBoarding)}</dd>
            </div>
            <div className="flex items-start justify-between gap-4 py-4">
              <dt className="text-blue-100">Aftercare</dt>
              <dd className="font-extrabold tabular-nums">{formatRand(estimate.aftercare)}</dd>
            </div>
            <div className="flex items-start justify-between gap-4 py-5">
              <dt className="font-extrabold">Estimated Monthly Total</dt>
              <dd className="text-xl font-black tabular-nums text-red-300" aria-live="polite">{formatRand(estimate.monthlyTotal)}</dd>
            </div>
          </dl>
          <div className="mt-5 rounded-xl bg-white/10 p-4">
            <div className="flex items-start justify-between gap-4">
              <p className="text-blue-100">Once-off / Registration</p>
              <p className="font-extrabold tabular-nums">{formatRand(estimate.onceOff)}</p>
            </div>
            <p className="mt-1 text-xs text-blue-200">
              {selections.applicant === 'new' ? 'New learner registration — non-refundable' : 'Returning learner re-registration'}
            </p>
          </div>
          <div className="mt-5 flex items-start gap-3 rounded-xl border border-white/15 p-4 text-sm">
            <span className="mt-0.5 text-red-300" aria-hidden="true">↗</span>
            <p className="text-blue-100">
              {estimate.transportRequired ? FEE_STRUCTURE_2027.transportMessage : 'Transport not included in this estimate.'}
            </p>
          </div>
          <p className="mt-6 text-xs leading-relaxed text-blue-200">
            This estimate is based on Harmony Learning Institute&apos;s published 2027 fee structure. Final fees and service availability should be confirmed with the school.
          </p>
        </div>
      </div>
    </section>
  );
};

export default FeeEstimator;