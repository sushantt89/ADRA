// Pick-lists. In the full system these become admin-configurable.
import type { AppConfig, Relationship, ServicePreset, VisitTemplate } from './types'

export const RELATIONSHIPS: Relationship[] = ['Primary', 'Partner', 'Child', 'Dependent', 'Parent', 'Other relative', 'Other']

export const GENDERS = ['Female', 'Male', 'Non-binary', 'Prefer not to say', 'Other']

export const INCOME_SOURCES = [
  'JobSeeker',
  'Age Pension',
  'Disability Support Pension',
  'Parenting Payment',
  'Carer Payment',
  'Youth Allowance / Austudy',
  'Wages (low income)',
  'No income',
  'Other',
]

export const CONCESSION_CARDS = ['None', 'Pensioner Concession Card', 'Health Care Card', 'Commonwealth Seniors Card', 'Other']

export const INDIGENOUS_STATUS = [
  'Neither Aboriginal nor Torres Strait Islander',
  'Aboriginal',
  'Torres Strait Islander',
  'Both Aboriginal and Torres Strait Islander',
  'Prefer not to say',
]

export const HOUSING = ['Renting (private)', 'Public / community housing', 'Own home', 'Living with family/friends', 'Temporary / crisis accommodation', 'Homeless / sleeping rough', 'Other']

export const SERVICE_TYPES = [
  'Food parcel',
  'Food voucher',
  'Clothing',
  'Bill assistance',
  'Crisis payment',
  'Accommodation support',
  'Transport assistance',
  'Pharmacy assistance',
  'Referral',
  'Other',
]

export const SUPPORT_METHODS = ['Parcel', 'Voucher', 'Cashless card', 'Digital code', 'Direct payment to provider', 'Referral only', 'Other']

export const DEFAULT_PRESETS: ServicePreset[] = [
  { id: 'p-food', order: 1, label: 'Food parcel', type: 'Food parcel', supportMethod: 'Parcel', value: 0, quantity: 1, colour: '#1f7a4d' },
  { id: 'p-voucher50', order: 2, label: 'Food voucher $50', type: 'Food voucher', supportMethod: 'Voucher', value: 50, quantity: 1, colour: '#2459a6' },
  { id: 'p-clothing', order: 3, label: 'Clothing', type: 'Clothing', supportMethod: 'Parcel', value: 0, quantity: 1, colour: '#8a4fbf' },
  { id: 'p-bill', order: 4, label: 'Bill help $100', type: 'Bill assistance', supportMethod: 'Direct payment to provider', value: 100, quantity: 1, colour: '#b4580f' },
  { id: 'p-transport', order: 5, label: 'Transport', type: 'Transport assistance', supportMethod: 'Voucher', value: 20, quantity: 1, colour: '#0f6f7a' },
  { id: 'p-referral', order: 6, label: 'Referral', type: 'Referral', supportMethod: 'Referral only', value: 0, quantity: 1, colour: '#5b6770' },
]

export const CONSENT_METHODS = ['Signed on screen', 'Verbal', 'Paper form'] as const

export const DEFAULT_TEMPLATES: VisitTemplate[] = [
  {
    id: 't-standard',
    label: 'Standard visit',
    wholeHousehold: true,
    items: [
      { type: 'Food parcel', supportMethod: 'Parcel', value: 0, quantity: 1 },
      { type: 'Transport assistance', supportMethod: 'Voucher', value: 20, quantity: 1 },
    ],
  },
  {
    id: 't-crisis',
    label: 'Crisis visit',
    wholeHousehold: true,
    items: [
      { type: 'Food parcel', supportMethod: 'Parcel', value: 0, quantity: 1 },
      { type: 'Food voucher', supportMethod: 'Voucher', value: 50, quantity: 1 },
      { type: 'Referral', supportMethod: 'Referral only', value: 0, quantity: 1 },
    ],
  },
]

export const DEFAULT_CONFIG: AppConfig = {
  id: 'main',
  orgName: 'ADRA',
  sites: ['Adelaide CBD', 'Salisbury', 'Elizabeth', 'Port Adelaide', 'Mobile unit'],
  serviceTypes: SERVICE_TYPES,
  supportMethods: SUPPORT_METHODS,
  eligibilityDays: 7,
  autoLockMinutes: 10,
  docketFooter: 'Please keep this docket and bring it to your next visit.',
  docket: {
    logo: 'builtin',
    colour: '#0f5f5c',
    subtitle: '',
    paper: 'A4',
    showHousehold: true,
    showServices: true,
    showEligibility: true,
    showAppointment: true,
    showInstructions: true,
    showSignature: false,
  },
  customFields: [
    {
      id: 'cf-referral',
      key: 'referralSource',
      label: 'How did you hear about us?',
      type: 'select',
      options: ['Word of mouth', 'Centrelink', 'Hospital / health service', 'School', 'Another charity', 'Other'],
      required: false,
      restricted: false,
      active: true,
    },
  ],
}
