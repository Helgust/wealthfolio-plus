import { Select as UiSelect, SelectItem } from "@wealthfolio/ui";
import { Children, isValidElement, useMemo, type ReactNode } from "react";

export interface SelectOption {
  value: string;
  label: ReactNode;
}

/** The value and label of every SelectItem under `node`, at any depth. */
export function collectSelectOptions(node: ReactNode): SelectOption[] {
  return Children.toArray(node).flatMap((child): SelectOption[] => {
    if (!isValidElement<{ value?: string; children?: ReactNode }>(child)) return [];
    if (child.type === SelectItem) {
      return [{ value: child.props.value ?? "", label: child.props.children }];
    }
    return collectSelectOptions(child.props.children);
  });
}

export interface SelectProps {
  value?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  children: ReactNode;
}

/**
 * Select that shows the selected item's label while closed. An item inside another component is
 * not seen, and shows its raw value until the list opens.
 */
export function Select({ value, onValueChange, disabled, children }: SelectProps) {
  const items = useMemo(() => collectSelectOptions(children), [children]);
  return (
    <UiSelect
      value={value}
      items={items}
      disabled={disabled}
      onValueChange={(next) => {
        if (next !== null) onValueChange?.(next);
      }}
    >
      {children}
    </UiSelect>
  );
}
