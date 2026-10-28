// Records a month's queue deposits as Wealthfolio transfers from one account to the envelopes'
// accounts, after the user confirms the list. Recorded deposits are remembered, so a second run
// records only what is missing.
import type { AddonContext } from '@wealthfolio/addon-sdk';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@wealthfolio/ui';
import { useState } from 'react';
import type { BudgetMonth } from '../engine/budget';
import { saveTransferPair } from '../lib/fork-api';
import { formatMoney } from '../lib/format';
import type { WfAccount } from '../lib/starting-point';
import type { Budget } from '../model/budget';
import { loadRecorded, saveRecorded } from '../model/budget-storage';

interface Props {
  ctx: AddonContext;
  budgetId: string;
  budget: Budget;
  row: BudgetMonth;
  accounts: WfAccount[];
  currency: string;
  /** Keys already recorded, see loadRecorded */
  recorded: string[];
  open: boolean;
  onClose: () => void;
  /** After any transfer was written */
  onRecorded: () => void;
}

export function RecordTransfersDialog(props: Props) {
  const { budget, row, accounts, currency, recorded, open, onClose } = props;
  const linked = new Set(budget.envelopes.map((e) => e.accountId));
  const [sourceId, setSourceId] = useState(
    () => (accounts.find((a) => !linked.has(a.id) && a.accountType === 'CASH') ?? accounts[0])?.id ?? '',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const source = accounts.find((a) => a.id === sourceId);

  const lines = budget.envelopes.flatMap((e) => {
    const amount = Math.round((row.deposits[e.id] ?? 0) * 100) / 100;
    if (amount < 0.01) return [];
    const key = `${props.budgetId}/${row.month}/${e.id}`;
    const to = accounts.find((a) => a.id === e.accountId);
    // shortcut: transfers only between accounts in the budget's currency; record others by hand.
    const skip = recorded.includes(key)
      ? 'already recorded'
      : !to
        ? 'envelope not linked to an account'
        : to.id === sourceId
          ? 'same account'
          : to.currency !== currency || source?.currency !== currency
            ? `not in ${currency}`
            : null;
    return [{ key, name: e.name, amount, to, skip }];
  });
  const todo = lines.filter((l) => l.skip === null);

  async function record() {
    setBusy(true);
    setError(null);
    const done = [...recorded];
    try {
      for (const l of todo) {
        await saveTransferPair(props.ctx, {
          fromAccountId: sourceId,
          toAccountId: l.to!.id,
          activityDate: new Date().toISOString(),
          sourceAmount: l.amount,
          destinationAmount: l.amount,
          sourceCurrency: currency,
          destinationCurrency: currency,
          notes: `Planificador ES: ${budget.name}, ${row.month}, ${l.name}`,
        });
        done.push(l.key);
      }
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      // Saved after a failure too: what was written must not be written again.
      if (done.length > recorded.length) {
        await saveRecorded(props.ctx.api.storage, done).catch((e) => setError(String(e)));
        props.onRecorded();
      }
      setBusy(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Record {row.month} in Wealthfolio</AlertDialogTitle>
          <AlertDialogDescription>
            The queue's deposits become transfers dated today from the account below. Check the list: they are written
            to your Wealthfolio data.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-3 text-sm">
          <Select value={sourceId} onValueChange={setSourceId}>
            <SelectTrigger>
              <SelectValue placeholder="From account" />
            </SelectTrigger>
            <SelectContent>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  From {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!lines.length && <p className="text-muted-foreground">The queue deposits nothing this month.</p>}
          {lines.map((l) => (
            <div key={l.key} className={`flex justify-between gap-4 ${l.skip ? 'text-muted-foreground' : ''}`}>
              <span>
                {l.name}
                {l.to && ` → ${l.to.name}`}
                {l.skip && ` (${l.skip})`}
              </span>
              <span className="tabular-nums">{formatMoney(l.amount, currency)}</span>
            </div>
          ))}
          {error && <p className="text-destructive">{error}</p>}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <Button disabled={busy || !source || !todo.length} onClick={record}>
            {busy ? 'Recording…' : `Record ${todo.length} transfer${todo.length === 1 ? '' : 's'}`}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
