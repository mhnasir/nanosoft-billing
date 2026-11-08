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
};

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

export const BILL_TITLE: Record<string, string> = Object.fromEntries(Object.entries(KIND).map(([k, v]) => [k, v.title]));

/** Bill columns as returned by GET /bills/:id, for each amount key. */
export const AMT_COL: Record<string, string> = {
  advAmt: 'AdvAmt', coolyAmt: 'CoolyAmt', kCoolyAmt: 'KCoolyAmt', basketAmt: 'BasketAmt', gunnyAmt: 'GunnyAmt',
  commissionAmt: 'CommissionAmt', othersAddAmt: 'OthersAddAmt', disAmt: 'DisAmt', othersLessAmt: 'OthersLessAmt',
};
