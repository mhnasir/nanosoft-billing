// The two bill screens of the old app: "Sales Bill" (SalesBill form, type B) and "Purchase Bill" (SuppliersBill form, type S).
// The field names are the Bill01 columns; the labels are what the old forms called them (several columns are used for
// something different from their name - the old grids were re-labelled per form - so they are mapped here, once).
export type AmtField = [key: string, label: string];

export type Kind = {
  title: string; // list title
  one: string; // "sales bill"
  party: string;
  partyType: 'C' | 'S';
  lot: boolean;
  /** amounts that raise (sales) or lower (purchase) the bill total */
  charges: AmtField[];
  chargesNote: string;
  /** amounts that lower (sales) or raise (purchase) the bill total */
  sides: AmtField[];
  sidesNote: string;
  chargesSign: 1 | -1;
  /** "Yes" switches: [flag, label, amount it fills, product column holding the rate per bag] */
  autos: [flag: string, label: string, fills: string, col: 'Cooly' | 'Basket' | 'Gunny'][];
  cash: string;
  /** a document: saved like a bill but it does not post to the ledger and shows no previous balance */
  doc?: boolean;
  /** a chit (delivery / order): items and bags only - no weight, rate or money */
  chit?: boolean;
  /** a line can be split among sub-customers, each with bags, weight and rate (the VB Bill03 lines) */
  split?: boolean;
  /** commission is worked out as a % of the items total */
  commPct?: boolean;
  /** pick the purchase bill (chitta) this bill settles */
  chitta?: boolean;
};

const FARMER_CHARGES: AmtField[] = [
  ['commissionAmt', 'Commission'], ['coolyAmt', 'Unloading cooly'], ['kCoolyAmt', 'Cleaning cooly'], ['basketAmt', 'Lorry hire'],
  ['gunnyAmt', 'Gunny'], ['advAmt', 'Advance'], ['othersAddAmt', 'Others'],
];

export const KIND: Record<string, Kind> = {
  B: {
    title: 'Sales bills', one: 'sales bill', party: 'Customer', partyType: 'C', lot: false,
    charges: [['advAmt', 'Commission'], ['coolyAmt', 'Cooly'], ['kCoolyAmt', 'Lorry hire'], ['basketAmt', 'Gunny'], ['othersAddAmt', 'Others']],
    chargesNote: 'Added to the bill', chargesSign: 1,
    sides: [['disAmt', 'Less'], ['othersLessAmt', 'Others']], sidesNote: 'Taken off the bill',
    autos: [['autoBasket', 'Commission by bag', 'advAmt', 'Basket'], ['autoCooly', 'Cooly by bag', 'coolyAmt', 'Cooly']],
    cash: 'Cash received',
  },
  S: {
    title: 'Purchase bills', one: 'purchase bill', party: 'Supplier / farmer', partyType: 'S', lot: true,
    charges: [
      ['commissionAmt', 'Commission'], ['coolyAmt', 'Unloading cooly'], ['kCoolyAmt', 'Cleaning cooly'], ['basketAmt', 'Lorry hire'],
      ['gunnyAmt', 'Gunny'], ['advAmt', 'Advance'], ['othersAddAmt', 'Others'],
    ],
    chargesNote: 'Deducted from the supplier', chargesSign: -1,
    sides: [['disAmt', 'Added'], ['othersLessAmt', 'Others added']], sidesNote: 'Added to the bill',
    autos: [['autoGunny', 'Unloading cooly by bag', 'coolyAmt', 'Gunny']],
    cash: 'Cash paid',
  },
};

const FARMER_BASE = {
  party: 'Farmer', partyType: 'S' as const, lot: true, doc: true, commPct: true,
  charges: FARMER_CHARGES, chargesNote: 'Deducted from the farmer', chargesSign: -1 as const,
  sides: [['disAmt', 'Added'], ['othersLessAmt', 'Others added']] as AmtField[], sidesNote: 'Added to the bill',
  autos: [['autoGunny', 'Unloading cooly by bag', 'coolyAmt', 'Gunny']] as Kind['autos'], cash: 'Cash paid',
};
const CHIT_BASE = {
  party: 'Customer / name', partyType: 'C' as const, lot: true, doc: true, chit: true,
  charges: [], chargesNote: '', chargesSign: 1 as const, sides: [], sidesNote: '', autos: [], cash: '',
};

// Documents (no ledger posting): delivery chit D, order O, farmer commission bill F, credit patiyal L, cash patiyal C.
KIND.D = { ...CHIT_BASE, title: 'Delivery chits', one: 'delivery chit' };
KIND.O = { ...CHIT_BASE, title: 'Orders', one: 'order' };
KIND.F = { ...FARMER_BASE, title: 'Farmer commission bills', one: 'farmer commission bill', chitta: true };
KIND.L = { ...FARMER_BASE, title: 'Patiyal bills (credit)', one: 'patiyal bill', split: true };
KIND.C = { ...FARMER_BASE, title: 'Cash patiyal', one: 'cash patiyal', split: true };

export const BILL_TITLE: Record<string, string> = Object.fromEntries(Object.entries(KIND).map(([k, v]) => [k, v.title]));

/** Bill columns as returned by GET /bills/:id, for each amount key. */
export const AMT_COL: Record<string, string> = {
  advAmt: 'AdvAmt', coolyAmt: 'CoolyAmt', kCoolyAmt: 'KCoolyAmt', basketAmt: 'BasketAmt', gunnyAmt: 'GunnyAmt',
  commissionAmt: 'CommissionAmt', othersAddAmt: 'OthersAddAmt', disAmt: 'DisAmt', othersLessAmt: 'OthersLessAmt',
};
