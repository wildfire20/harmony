import { FEE_STRUCTURE_2027, calculateFeeEstimate } from './fees2027';

const estimate = (overrides = {}) => calculateFeeEstimate({
  learnerCategory: 'grade-r',
  boarding: 'no',
  aftercare: 'no',
  applicant: 'new',
  transport: 'none',
  paymentPlan: 'monthly',
  ...overrides,
});

describe('2027 public fee estimator', () => {
  test.each([
    ['baby', 1900],
    ['preschool', 1850],
    ['grade-r', 1850],
    ['grades-1-7', 2350],
  ])('uses the verified monthly fee for %s', (learnerCategory, monthlyTotal) => {
    expect(estimate({ learnerCategory }).monthlyTotal).toBe(monthlyTotal);
  });

  test.each([
    ['baby', 3650],
    ['preschool', 3650],
    ['grade-r', 3650],
    ['grades-1-7', 3950],
  ])('uses the inclusive boarding total for %s', (learnerCategory, monthlyTotal) => {
    const result = estimate({ learnerCategory, boarding: 'yes', aftercare: 'yes' });
    expect(result.monthlyTotal).toBe(monthlyTotal);
    expect(result.aftercare).toBe(0);
    expect(result.boardingIncludesAftercare).toBe(true);
  });

  test.each(['onverwacht', 'kotas'])('%s transport adds R650', (transport) => {
    const result = estimate({ transport });
    expect(result.transport).toBe(650);
    expect(result.monthlyTotal).toBe(2500);
  });

  test('unsupported transport values are not priced', () => {
    expect(estimate({ transport: 'other-route' }).transport).toBe(0);
  });

  test('6 months upfront applies 50% off month 6', () => {
    expect(estimate({ paymentPlan: 'half-year' }).paymentPlanAmount).toBe(10175);
  });

  test('12 months upfront makes month 12 free', () => {
    expect(estimate({ paymentPlan: 'full-year' }).paymentPlanAmount).toBe(20350);
  });

  test.each([
    ['baby', 'new', 650],
    ['preschool', 'new', 650],
    ['grade-r', 'new', 650],
    ['grades-1-7', 'new', 800],
    ['grades-1-7', 'returning', 500],
  ])('uses verified registration for %s %s applicants', (learnerCategory, applicant, onceOff) => {
    expect(estimate({ learnerCategory, applicant }).onceOff).toBe(onceOff);
  });

  test.each(['baby', 'preschool', 'grade-r'])('does not invent %s re-registration', (learnerCategory) => {
    const result = estimate({ learnerCategory, applicant: 'returning' });
    expect(result.onceOff).toBeNull();
    expect(result.onceOffConfirmed).toBe(false);
  });

  test('does not auto-calculate the sibling discount', () => {
    const result = estimate();
    expect(result.monthlyTotal).toBe(1850);
    expect(result).not.toHaveProperty('siblingDiscount');
    expect(FEE_STRUCTURE_2027.discounts.siblingAmount).toBe(150);
    expect(FEE_STRUCTURE_2027.discounts.sibling).toContain('Please confirm with Harmony');
  });
});