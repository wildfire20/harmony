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
      reRegistration: 0,
    },
    preschool: {
      label: 'Toddlers / Preschool (3–6)',
      shortLabel: 'Toddlers / Preschool',
      group: 'Early Learning',
      monthlyTuition: 1850,
      monthlyBoarding: 3650,
      newRegistration: 650,
      reRegistration: 0,
    },
    'grade-r': {
      label: 'Grade R',
      shortLabel: 'Grade R',
      group: 'Early Learning',
      monthlyTuition: 1850,
      monthlyBoarding: 3650,
      newRegistration: 650,
      reRegistration: 0,
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
      label: '6 months upfront — half a month’s discount',
      estimateLabel: '6 months upfront',
      multiplier: 5.5,
    },
    'full-year': {
      label: 'Annual upfront — pay for 11 months',
      estimateLabel: '12 months upfront',
      multiplier: 11,
    },
  },
  discounts: {
    halfYear: 'Pay six months’ school fees once off in January and get half a month’s discount.',
    fullYear: 'Pay 11 months’ school fees once off in January and get one month free.',
    siblingAmount: 150,
    sibling: 'With two children enrolled at Harmony, you save R300 every month.',
  },
  saturdayClasses: 'Free for currently enrolled Harmony learners.',
  admissionRequirements: {
    allLearners: [
      'Copy of the child’s birth certificate',
      'Copies of the parent’s or guardian’s ID',
      'Road to Health / Clinic Card',
    ],
    grades1to7Additional: [
      'Latest school progress report from the previous school',
      'Transfer letter from the previous school',
    ],
  },
  banking: {
    bank: 'FNB / First National Bank',
    accountHolder: 'Harmony Learning Institute',
    accountNumber: '63035320265',
    branchCode: '250655',
    reference: 'Always use your child’s reference number when making a payment.',
  },
};

export const ADMISSIONS_FAQS_2027 = [
  ['When are 2027 applications open?', '2027 admissions are currently open.'],
  ['How much is Baby Class?', 'Baby Class is R1,900 per month.'],
  ['How much are Toddlers and Grade R?', 'Toddlers / Preschool and Grade R are R1,850 per month.'],
  ['How much are Grades 1–7?', 'Grades 1–7 are R2,350 per month.'],
  ['How much is boarding?', 'Boarding is R3,650 per month for Preschool and R3,950 per month for Grades 1–7.'],
  ['Does boarding include tuition?', 'Yes. Boarding includes school fees, boarding fees and aftercare.'],
  ['How much is transport?', 'Transport is R650 per month.'],
  ['Where is transport currently available?', 'Transport is currently available only in Onverwacht and Kotas.'],
  ['Are Saturday classes charged separately?', 'No. Saturday classes are free for currently enrolled Harmony learners.'],
  ['Are sibling discounts available?', `Yes. ${FEE_STRUCTURE_2027.discounts.sibling}`],
  ['What documents are required?', [
    ...FEE_STRUCTURE_2027.admissionRequirements.allLearners,
    ...FEE_STRUCTURE_2027.admissionRequirements.grades1to7Additional.map(item => `${item} (Grades 1–7)`),
  ]],
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
