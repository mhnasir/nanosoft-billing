# VB6 (NVS) → React migration map

Source: `F:\HasonNa\NVS22062026` (99 forms, 20 classes, ~90 Data Report designers).
Target: this project, on PostgreSQL. The old data is copied once from `NVS2026` (SQL Server) with `export-from-mssql.cmd` + `npm run import`; after that the VB6 app and this app have separate databases.

## Done in release 0.1 (core billing MVP)

| New screen | Replaces VB6 | How data is written (PostgreSQL) |
|---|---|---|
| Login | frmLogin / LOGIN / Pass | reads `USERMASTER`, then `STAFFMAST` |
| Customers / suppliers | Custmaster, Supmast, BranMast, CustAddfrm | `SupMast`, `PHONEMAST` (direct SQL, soft delete `STAT=1`) |
| Party groups | Custtype, Grouptype | `CUSTTYPEMAST` |
| Products | ProductMaster, ProdMaster, ProdEnty | `ProductMast` |
| Marks, Banks | MarkMaster, BankMast | `MarkMaster`, `BankMast` |
| Customer bill (type B) | Bill, SalesBill | server code replacing `InsUp_Bill01` + `INSUP_Bill02` (posts to `fatrans`) |
| Supplier bill (type S) | SuppliersBill, PurchaseBill | same code, credit side |
| Receipts / Payments | RecPayDetail, RecPayDetail01, PaymentDetails | `recpay01`/`recpay02` + ledger posting (replaces `INSUP_RECPAY02`) |
| Party ledger | CustomerLedger (`Rpt_DebLedg`) | read-only query on `FATRANS` (no shared temp table) |
| Outstanding | CustBalRpt* | read-only |
| Day book | DAILYCASHBILL, reports | read-only |
| Trial balance | TrialBalance | read-only, by party group |
| Bill print | BillRpt*.Dsr | browser print / Save as PDF |
| Delivery chit (type D), Order (type O) | SalesBill (D/O), loading chits | bags only, no amounts; a document - no ledger posting. Orders share the sales bill number counter |
| Farmer commission bill (type F) | FormerComBill | purchase-style statement with COM %, cooly, gunny, lorry hire; points at the purchase bill (chitta) through `SubBillKey`; a document - no ledger posting |
| Patiyal bill (type L), Cash patiyal (type C) | PattiyalBillnew, CashPatiyal, Patiyal | each line is split among sub-customers (`Bill03`: bags, weight, own rate); COM %; a document - no ledger posting |

## Not migrated yet (suggested order)

1. **Patti follow-ups** (first version built, to be corrected against the client's real workflow): types `P`, `Y`, `T` and the `CommissionBill` form are not built; `PatiyalToSales` (turn a patti into sales bills) is not built; patti / farmer bills do not post to the farmer's ledger (the VB `InsUp_Bill01` only posts types B and S) - decide with the client whether they should; COM % is not stored on the bill (only the resulting commission amount); the print layouts are plain.
2. **Stock** (Stock, StockLedger, StockDetails, TallyStockSheet, RetailsTally, LotProfitLess) - `StockLedger`, `ProductStock`.
3. **Order bills** (OrderBill, OrderWeight, OuterBill) - `OrderBill*`.
4. **Bank / cash book** (BankBill, RptBankFrm, BusinessFlow, PLFRM, BalanceSheet).
5. **Transport bill, TKBILL, CalcPack\*** (packing calculators).
6. **Remaining Data Report designers** (Crystal/DSR layouts in `Rpt\`), Tamil/Malayalam bill layouts.
7. **Utilities**: staff master, backup/restore, WhatsApp/PDF sending (`AutoPdfWa.bas`, `whatsapp.ini`), user rights.

## Known differences / things to confirm with a real data check

- Bill numbering: next number = max(BillNo)+1 for that bill type within the Apr-Mar financial year (as in the VB app).
- Line amount = Qty × Rate. Product-specific calculators (`ProductMast.CalcStr`, `Ptype`, basket/gunny rules) are not applied yet.
- Commission, cooly, basket etc. are entered as amounts; the VB app can compute some from percentages.
- Tamil/Malayalam product names are stored in a legacy font encoding (`TAMIL3.TTF`); the print view shows English names only.
- Bill types `B` and `S` were identified from the old stored procedures (`B` debits the party, `S` credits it). Please check against a few real bills.
