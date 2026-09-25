// Where the money of a year came from and where it went — the Cash flow tab (Sankey).
// Sources: income and money taken out of accounts; uses: taxes, spending, money put into
// accounts. Both sides add up to the same total (tested for every year).
import type { LedgerRow } from '../engine/run-plan';
import { inMode, type ValueMode } from './format';

export type FlowGroup = 'income' | 'accounts' | 'taxes' | 'spending' | 'saving';

export interface FlowItem {
  key: string;
  label: string;
  group: FlowGroup;
  value: number;
}

export interface YearFlows {
  /** Non-zero sources, in a fixed order */
  sources: FlowItem[];
  /** Non-zero uses, in a fixed order: taxes, spending, saving */
  uses: FlowItem[];
  total: number;
}

export function yearFlows(row: LedgerRow, mode: ValueMode = 'nominal'): YearFlows {
  const item = (key: string, label: string, group: FlowGroup, value: number): FlowItem => ({
    key,
    label,
    group,
    value: inMode(value, row.deflator, mode),
  });
  const w = row.withdrawals;
  const d = row.deposits;
  const re = row.realEstate;
  const sources = [
    item('revenue', 'Autónomo revenue', 'income', row.revenue),
    item('publicPension', 'Seguridad Social pension', 'income', row.publicPension),
    item('investmentIncome', 'Interest & dividends', 'income', row.investmentIncome),
    item('fromCash', 'From cash', 'accounts', w.cash),
    item('fromFund', 'Sold fondos', 'accounts', w.fund),
    item('fromBrokerage', 'Sold brokerage', 'accounts', w.brokerage),
    item('fromPension', 'Pension plan payouts', 'accounts', w.pension),
    item('saleProceeds', 'Property sale', 'accounts', re.saleProceeds),
    item('newLoans', 'New mortgage', 'accounts', re.newLoans),
    item('shortfall', 'Shortfall (cash below zero)', 'accounts', row.shortfall),
  ];
  const uses = [
    item('irpf', 'IRPF', 'taxes', row.irpf),
    item('reta', 'RETA', 'taxes', row.reta),
    item('ibi', 'IBI', 'taxes', re.ibi),
    item('purchaseTax', 'Purchase tax (ITP / IVA + AJD)', 'taxes', re.purchaseTax),
    item('businessExpenses', 'Business expenses', 'spending', row.businessExpenses),
    item('essential', 'Essential expenses', 'spending', row.essentialExpenses),
    item('discretionary', 'Discretionary expenses', 'spending', row.discretionaryExpenses),
    item('loanInterest', 'Loan interest', 'spending', re.loanInterest),
    item('toCash', 'To cash', 'saving', d.cash),
    item('toFund', 'To fondos', 'saving', d.fund),
    item('toBrokerage', 'To brokerage', 'saving', d.brokerage),
    item('toPension', 'To pension plans', 'saving', d.pension),
    item('loanPrincipal', 'Loan principal', 'saving', re.loanPrincipal + re.loanRepaidAtSale),
    item('purchaseCost', 'Property purchase', 'saving', re.purchaseCost),
  ];
  // Amounts below a cent are rounding noise of the gross-up iteration.
  const shown = (xs: FlowItem[]) => xs.filter((x) => x.value >= 0.005);
  return {
    sources: shown(sources),
    uses: shown(uses),
    total: sources.reduce((s, x) => s + x.value, 0),
  };
}
