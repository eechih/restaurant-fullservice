import { useState } from 'react';
import {
  formatMoney,
  missingRequiredGroups,
  toggleChoice,
  unitPriceOf,
  type MenuItem,
  type OptionSelection,
} from '../domain';
import { Modal } from './Modal';

export function ItemDialog({
  item,
  onClose,
  onAdd,
}: {
  item: MenuItem;
  onClose(): void;
  onAdd(selection: OptionSelection, quantity: number, note: string): void;
}) {
  const [selection, setSelection] = useState<OptionSelection>({});
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState('');
  const missing = missingRequiredGroups(item, selection);
  const unitPrice = unitPriceOf(item, selection);

  return (
    <Modal
      title={item.name}
      onClose={onClose}
      footer={
        <button
          className="button button-primary button-wide"
          disabled={missing.length > 0}
          onClick={() => onAdd(selection, quantity, note)}
        >
          {missing.length > 0
            ? `請選擇${missing.map((group) => group.name).join('、')}`
            : `加入　${formatMoney(unitPrice * quantity)}`}
        </button>
      }
    >
      {item.optionGroups.map((group) => (
        <fieldset key={group.id} className="option-group">
          <legend className="field-label">
            {group.name}
            <span className="field-hint">
              {group.required ? '必選' : '可不選'}
              {group.multiple ? '・可複選' : ''}
            </span>
          </legend>
          <div className="chip-row">
            {group.choices.map((choice) => {
              const selected = selection[group.id]?.includes(choice.id) ?? false;
              return (
                <button
                  key={choice.id}
                  aria-pressed={selected}
                  className={selected ? 'chip is-selected' : 'chip'}
                  onClick={() => setSelection(toggleChoice(selection, group, choice.id))}
                >
                  {choice.name}
                  {choice.priceDelta > 0 && ` +${choice.priceDelta}`}
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}
      <label className="field-label" htmlFor="line-note">備註</label>
      <input
        id="line-note"
        className="text-input"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="例如：不要蔥"
      />
      <p className="field-label">數量</p>
      <Stepper value={quantity} min={1} onChange={setQuantity} label={item.name} />
    </Modal>
  );
}

export function Stepper({
  value,
  min,
  onChange,
  label,
}: {
  value: number;
  min: number;
  onChange(value: number): void;
  label: string;
}) {
  return (
    <div className="stepper">
      <button
        className="stepper-button"
        disabled={value <= min}
        aria-label={`減少${label}數量`}
        onClick={() => onChange(value - 1)}
      >
        −
      </button>
      <span aria-live="polite">{value}</span>
      <button className="stepper-button" aria-label={`增加${label}數量`} onClick={() => onChange(value + 1)}>
        +
      </button>
    </div>
  );
}
