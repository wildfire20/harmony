export const FEE_STRUCTURE_2027 = {
  year: 2027,
  paymentPeriod: 'January to December 2027',
  learnerCategories: {
    baby: {
      label: 'Baby Class (0–2)',
      shortLabel: 'Baby Class',
      group: 'Early Learning',
      monthlyTuition: 1900,
      monthlyBoarding: 3650,
      newRegistration: 650,
      reRegistration: null,
    },
    preschool: {
      label: 'Toddlers / Preschool (3–6)',
      shortLabel: 'Toddlers / Preschool',
      group: 'Early Learning',
      monthlyTuition: 1850,
      monthlyBoarding: 3650,
      newRegistration: 650,
      reRegistration: null,
    },
    'grade-r': {
      label: 'Grade R',
      shortLabel: 'Grade R',
      group: 'Early Learning',
      monthlyTuition: 1850,
      monthlyBoarding: 3650,
      newRegistration: 650,
      reRegistration: null,
    },
    'grades-1-7': {
      label: 'Grades 1–7',
      shortLabel: 'Grades 1–7',
      group: 'Primary School',
      monthlyTuition: 2350,
      monthlyBoarding: 3950,
      newRegistration: 800,
      reRegistration: 500,
    },
  },
  monthly: {
    aftercare: 550,
    transport: 650,
  },
  transportRoutes: [
    { value: 'none', label: 'No transport' },
    { value: 'onverwacht', label: 'Onverwacht' },
    { value: 'kotas', label: 'Kotas' },
  ],
  boardingIncludes: ['School fees', 'Boarding fees', 'Aftercare'],
  boardingEstimateLabel: 'Boarding (tuition + aftercare included)',
  boardingSummary: 'Boarding already includes school fees, boarding fees and aftercare.',
  paymentPlans: {
    monthly: {
      label: 'Monthly (January–December)',
      estimateLabel: 'Monthly',
      multiplier: 1,
    },
    'half-year': {
      label: '6 months upfront — 50% off month 6',
      estimateLabel: '6 months upfront',
      multiplier: 5.5,
    },
    'full-year': {
      label: '12 months upfront — month 12 free',
      estimateLabel: '12 months upfront',
      multiplier: 11,
    },
  },
  discounts: {
    halfYear: '50% discount on the 6th month’s fee',
    fullYear: '100% discount on the 12th month’s fee',
    siblingAmount: 150,
    sibling: 'Sibling discount available: R150 per learner. Please confirm with Harmony how this discount is applied.',
  },
  saturdayClasses: 'Free for currently enrolled Harmony learners.',
  admissionRequirements: {
    allLearners: [
      'Copy of learner birth certificate',
      'Copies of Parent/Guardian ID',
      'Road to Health / Clinic Card',
    ],
    grades1to7Additional: [
      'Latest school progress report',
      'Transfer from previous school',
    ],
  },
  banking: {
    bank: 'FNB / First National Bank',
    accountHolder: 'Harmony Learning Institute',
    accountNumber: '63035320265',
    branchCode: '250655',
    reference: 'Please confirm with Harmony',
  },
};

export const ADMISSIONS_FAQS_2027 = [
  ['When are 2027 applications open?', '2027 admissions are currently open.'],
  ['How much is Baby Class?', 'Baby Class is R1,900 per month.'],
  ['How much are Toddlers and Grade R?', 'Toddlers / Preschool and Grade R are R1,850 per month.'],
  ['How much are Grades 1–7?', 'Grades 1–7 are R2,350 per month.'],
  ['How much is boarding?', 'Boarding is R3,650 per month for Baby Class through Grade R and R3,950 per month for Grades 1–7.'],
  ['Does boarding include tuition?', 'Yes. Boarding includes school fees, boarding fees and aftercare.'],
  ['How much is transport?', 'Transport is R650 per month.'],
  ['Where is transport currently available?', 'Transport is currently available only in Onverwacht and Kotas.'],
  ['Are Saturday classes charged separately?', 'No. Saturday classes are free for currently enrolled Harmony learners.'],
  ['Are sibling discounts available?', 'Yes. Harmony offers a R150 discount per learner for families with more than one learner enrolled. Contact the school to confirm how it is applied.'],
  ['What documents are required?', 'All applicants need a learner birth certificate copy, Parent/Guardian ID copies and a Road to Health / Clinic Card. Grades 1–7 also need the latest school progress report and a transfer from the previous school.'],
];

export const formatRand = (amount) => (
  typeof amount === 'number' ? `R${amount.toLocaleString('en-US')}` : 'Please confirm'
);

export const calculateFeeEstimate = ({
  learnerCategory = 'grade-r',
  boarding = 'no',
  aftercare = 'no',
  applicant = 'new',
  transport = 'none',
  paymentPlan = 'monthly',
}) => {
  const category = FEE_STRUCTURE_2027.learnerCategories[learnerCategory]
    || FEE_STRUCTURE_2027.learnerCategories['grade-r'];
  const hasBoarding = boarding === 'yes';
  const tuitionOrBoarding = hasBoarding ? category.monthlyBoarding : category.monthlyTuition;
  const aftercareAmount = !hasBoarding && aftercare === 'yes'
    ? FEE_STRUCTURE_2027.monthly.aftercare
    : 0;
  const transportAmount = ['onverwacht', 'kotas'].includes(transport)
    ? FEE_STRUCTURE_2027.monthly.transport
    : 0;
  const monthlyTotal = tuitionOrBoarding + aftercareAmount + transportAmount;
  const onceOffAmount = applicant === 'new' ? category.newRegistration : category.reRegistration;
  const paymentPlanConfig = FEE_STRUCTURE_2027.paymentPlans[paymentPlan]
    || FEE_STRUCTURE_2027.paymentPlans.monthly;
  const paymentPlanAmount = monthlyTotal * paymentPlanConfig.multiplier;

  return {
    category,
    tuitionOrBoarding,
    aftercare: aftercareAmount,
    transport: transportAmount,
    monthlyTotal,
    onceOff: onceOffAmount,
    onceOffConfirmed: onceOffAmount !== null,
    boardingIncludesAftercare: hasBoarding,
    paymentPlan,
    paymentPlanConfig,
    paymentPlanAmount,
  };
};