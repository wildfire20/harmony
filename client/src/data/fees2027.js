export const FEE_STRUCTURE_2027 = {
  year: 2027,
  monthly: {
    gradeR: 1850,
    grades1to7: 2350,
    boardingGradeRCategory: 3650,
    boardingGrades1to7: 3950,
    aftercare: 550,
  },
  onceOff: {
    newRegistration: 800,
    reRegistration: 500,
  },
  paymentPeriod: 'January to December 2027',
  paymentMethods: [
    'EFT monthly on or before the 3rd of every month',
    'Card-machine payment at the school',
    'Annual payment in advance qualifies for a one-month fee discount',
  ],
  transportMessage: 'Transport pricing depends on route and availability. Please contact Harmony for a quotation.',
};

export const formatRand = (amount) => `R${amount.toLocaleString('en-US')}`;

export const calculateFeeEstimate = ({
  learnerCategory = 'grade-r',
  boarding = 'no',
  aftercare = 'no',
  applicant = 'new',
  transport = 'not-required',
}) => {
  const isGradeR = learnerCategory === 'grade-r';
  const hasBoarding = boarding === 'yes';
  const tuitionOrBoarding = hasBoarding
    ? (isGradeR ? FEE_STRUCTURE_2027.monthly.boardingGradeRCategory : FEE_STRUCTURE_2027.monthly.boardingGrades1to7)
    : (isGradeR ? FEE_STRUCTURE_2027.monthly.gradeR : FEE_STRUCTURE_2027.monthly.grades1to7);
  const aftercareAmount = aftercare === 'yes' ? FEE_STRUCTURE_2027.monthly.aftercare : 0;
  const onceOffAmount = applicant === 'new'
    ? FEE_STRUCTURE_2027.onceOff.newRegistration
    : FEE_STRUCTURE_2027.onceOff.reRegistration;

  return {
    tuitionOrBoarding,
    aftercare: aftercareAmount,
    monthlyTotal: tuitionOrBoarding + aftercareAmount,
    onceOff: onceOffAmount,
    transportRequired: transport === 'interested',
  };
};