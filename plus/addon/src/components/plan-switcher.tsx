// Picker and actions for plans or budgets. Deletion is confirmed in a dialog: the sandbox has no confirm().
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

interface Props {
  items: { id: string; name: string }[];
  activeId: string;
  max: number;
  /** "plan" or "budget" */
  noun: string;
  disabled?: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

export function PlanSwitcher({ items, activeId, max, noun, disabled, onSelect, onNew, onDuplicate, onDelete }: Props) {
  const [confirming, setConfirming] = useState(false);
  const full = items.length >= max;
  const Noun = noun[0].toUpperCase() + noun.slice(1);
  return (
    <div className="flex items-center gap-2">
      <Select value={activeId} onValueChange={onSelect} disabled={disabled}>
        <SelectTrigger aria-label={Noun} style={{ width: 200 }}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((e) => (
            <SelectItem key={e.id} value={e.id}>
              {e.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" aria-label={`${Noun} actions`} disabled={disabled}>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={full} onSelect={onNew}>
            <Plus className="h-4 w-4" /> New {noun}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={full} onSelect={onDuplicate}>
            <Copy className="h-4 w-4" /> Duplicate
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={items.length < 2} onSelect={() => setConfirming(true)}>
            <Trash2 className="h-4 w-4" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{items.find((e) => e.id === activeId)?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The {noun} is removed from the addon storage. Other {noun}s and Wealthfolio data stay as they are.
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
