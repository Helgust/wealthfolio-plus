// Plan picker and plan actions. Deletion is confirmed in a dialog: the sandbox has no confirm().
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@wealthfolio/ui';
import { Copy, MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { activeEntry, MAX_PLANS, type PlanBook } from '../model/plan-storage';

interface Props {
  book: PlanBook;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

export function PlanSwitcher({ book, onSelect, onNew, onDuplicate, onDelete }: Props) {
  const [confirming, setConfirming] = useState(false);
  const full = book.entries.length >= MAX_PLANS;
  return (
    <div className="flex items-center gap-2">
      <Select value={book.activeId} onValueChange={onSelect}>
        <SelectTrigger aria-label="Plan" style={{ width: 200 }}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {book.entries.map((e) => (
            <SelectItem key={e.id} value={e.id}>
              {e.plan.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" aria-label="Plan actions">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={full} onSelect={onNew}>
            <Plus className="h-4 w-4" /> New plan
          </DropdownMenuItem>
          <DropdownMenuItem disabled={full} onSelect={onDuplicate}>
            <Copy className="h-4 w-4" /> Duplicate
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={book.entries.length < 2} onSelect={() => setConfirming(true)}>
            <Trash2 className="h-4 w-4" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{activeEntry(book).plan.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The plan is removed from the addon storage. Other plans and Wealthfolio data stay as they are.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
