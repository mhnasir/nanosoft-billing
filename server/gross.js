// Bill total as the old forms work it out (the amount that goes to the ledger).
//   Sales bill (B):    bill amount + charges - discounts      (charges are added to what the customer owes)
//   Purchase bill (S): bill amount + added amounts - charges  (commission, cooly, lorry hire ... are deducted from the farmer)
const CHARGES = `(COALESCE(b.advamt,0)+COALESCE(b.coolyamt,0)+COALESCE(b.kcoolyamt,0)+COALESCE(b.basketamt,0)+COALESCE(b.gunnyamt,0)
  +COALESCE(b.commissionamt,0)+COALESCE(b.englishamt,0)+COALESCE(b.othersaddamt,0))`;

export const GROSS = `(CASE WHEN b.billtype IN ('S','F','L','C')
  THEN b.billamt + COALESCE(b.disamt,0) + COALESCE(b.otherslessamt,0) - ${CHARGES}
  ELSE b.billamt + ${CHARGES} - (COALESCE(b.disamt,0)+COALESCE(b.otherslessamt,0)+COALESCE(b.basketlessamt,0)) END)`;
