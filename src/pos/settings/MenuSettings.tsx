import { useState } from 'react';
import { useAction, useApp } from '../../appContext';
import {
  formatMoney,
  MAX_NAME_LENGTH,
  menuItemProblems,
  moveBy,
  nextSortOrder,
  type CatalogChange,
  type MenuCategory,
  type MenuItem,
  type OptionChoice,
  type OptionGroup,
  type Station,
} from '../../domain';
import { Modal } from '../../ui/Modal';

/** Saves catalog changes, reporting failure, and blocks repeat taps meanwhile. */
export function useCatalogChange() {
  const { actions, notify } = useApp();
  const { busy, run } = useAction();
  const change = (changes: CatalogChange[], { done, failure = '儲存失敗' }: { done?: string; failure?: string } = {}) =>
    run(async () => {
      await actions.changeCatalog(changes);
      if (done) notify(done);
    }, failure);
  return { busy, change };
}

/** An empty field is kept as NaN, so validation can report it instead of saving 0. */
const toNumber = (value: string) => (value.trim() === '' ? Number.NaN : Number(value));
const fromNumber = (value: number) => (Number.isNaN(value) ? '' : String(value));

export function MenuSettings() {
  const { catalog } = useApp();
  const { busy, change } = useCatalogChange();
  const [selectedId, setSelectedId] = useState<string>();
  const [editingCategory, setEditingCategory] = useState<MenuCategory | 'new'>();
  const [editingItem, setEditingItem] = useState<MenuItem | 'new'>();
  const [deletingItem, setDeletingItem] = useState<MenuItem>();

  const category = catalog.categories.find((c) => c.id === selectedId) ?? catalog.categories[0];
  const items = catalog.items.filter((item) => item.categoryId === category?.id);

  const move = <T extends { id: string; sortOrder: number }>(
    records: T[],
    id: string,
    offset: -1 | 1,
    toChange: (record: T) => CatalogChange,
  ) => {
    const moved = moveBy(records, id, offset);
    if (moved) void change(moved.map(toChange), { failure: '調整順序失敗' });
  };

  return (
    <div className="menu-settings">
      <section className="settings-panel" aria-label="分類">
        <div className="settings-panel-header">
          <h2>分類</h2>
          <button className="button button-small" onClick={() => setEditingCategory('new')}>新增分類</button>
        </div>
        {catalog.categories.length === 0 && <p className="empty-note">先新增一個分類，例如「主餐」</p>}
        <ul className="settings-list">
          {catalog.categories.map((candidate) => {
            const count = catalog.items.filter((item) => item.categoryId === candidate.id).length;
            return (
              <li key={candidate.id} className={candidate.id === category?.id ? 'is-selected' : ''}>
                <button className="settings-list-name" onClick={() => setSelectedId(candidate.id)}>
                  {candidate.name}
                  <span className="field-hint">
                    {count} 項
                    {candidate.stationId && ` · ${stationLabel(catalog.stations, candidate.stationId)}`}
                  </span>
                </button>
                <MoveButtons
                  label={candidate.name}
                  disabled={busy}
                  onMove={(offset) =>
                    move(catalog.categories, candidate.id, offset, (record) => ({
                      type: 'category/save',
                      category: record,
                      isNew: false,
                    }))
                  }
                />
                <button className="link-button" onClick={() => setEditingCategory(candidate)}>編輯</button>
                <button
                  className="link-button link-danger"
                  disabled={busy || count > 0}
                  title={count > 0 ? '分類裡還有品項，請先刪除或移走' : undefined}
                  onClick={() =>
                    change([{ type: 'category/delete', id: candidate.id }], {
                      done: `已刪除分類 ${candidate.name}`,
                      failure: '刪除分類失敗',
                    })
                  }
                >
                  刪除
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {category && (
        <section className="settings-panel" aria-label={`${category.name} 的品項`}>
          <div className="settings-panel-header">
            <h2>{category.name}</h2>
            <button className="button button-small button-primary" onClick={() => setEditingItem('new')}>
              新增品項
            </button>
          </div>
          {items.length === 0 && <p className="empty-note">這個分類還沒有品項</p>}
          <ul className="settings-list">
            {items.map((item) => (
              <li key={item.id}>
                <div className="settings-list-name">
                  {item.name}
                  <span className="field-hint">
                    {formatMoney(item.price)}
                    {item.optionGroups.length > 0 && ` · ${item.optionGroups.map((g) => g.name).join('、')}`}
                    {item.stationId && ` · ${stationLabel(catalog.stations, item.stationId)}`}
                    {item.noServiceCharge && ' · 不收服務費'}
                  </span>
                  {item.available === false && <span className="badge badge-warn">售完</span>}
                </div>
                <MoveButtons
                  label={item.name}
                  disabled={busy}
                  onMove={(offset) =>
                    move(items, item.id, offset, (record) => ({ type: 'item/save', item: record, isNew: false }))
                  }
                />
                <button className="link-button" onClick={() => setEditingItem(item)}>編輯</button>
                <button className="link-button link-danger" onClick={() => setDeletingItem(item)}>刪除</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {editingCategory && (
        <CategoryDialog
          category={editingCategory === 'new' ? undefined : editingCategory}
          onClose={() => setEditingCategory(undefined)}
          onCreated={setSelectedId}
        />
      )}
      {editingItem && category && (
        <ItemEditor
          item={editingItem === 'new' ? undefined : editingItem}
          categoryId={category.id}
          onClose={() => setEditingItem(undefined)}
        />
      )}
      {deletingItem && <DeleteItemDialog item={deletingItem} onClose={() => setDeletingItem(undefined)} />}
    </div>
  );
}

const stationLabel = (stations: Station[], id: string) =>
  stations.find((station) => station.id === id)?.name ?? '已刪除的出餐站';

/** Picks a station. The empty choice means the default, which `none` describes. */
function StationSelect({
  id,
  value,
  none,
  onChange,
}: {
  id: string;
  value: string | null | undefined;
  none: string;
  onChange(stationId: string | null): void;
}) {
  const { catalog } = useApp();
  return (
    <select
      id={id}
      className="text-input"
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value || null)}
    >
      <option value="">{none}</option>
      {catalog.stations.map((station) => (
        <option key={station.id} value={station.id}>
          {station.name}
        </option>
      ))}
    </select>
  );
}

export function MoveButtons({
  label,
  disabled,
  onMove,
}: {
  label: string;
  disabled: boolean;
  onMove(offset: -1 | 1): void;
}) {
  return (
    <span className="move-buttons">
      <button className="icon-button" disabled={disabled} aria-label={`${label} 往前`} onClick={() => onMove(-1)}>
        ↑
      </button>
      <button className="icon-button" disabled={disabled} aria-label={`${label} 往後`} onClick={() => onMove(1)}>
        ↓
      </button>
    </span>
  );
}

function CategoryDialog({
  category,
  onClose,
  onCreated,
}: {
  category?: MenuCategory;
  onClose(): void;
  onCreated(id: string): void;
}) {
  const { catalog } = useApp();
  const { busy, change } = useCatalogChange();
  const [name, setName] = useState(category?.name ?? '');
  const [stationId, setStationId] = useState(category?.stationId ?? null);
  const trimmed = name.trim();
  const valid = trimmed.length > 0 && trimmed.length <= MAX_NAME_LENGTH;

  const save = () => {
    const saved = category
      ? { ...category, name: trimmed, stationId }
      : { id: crypto.randomUUID(), name: trimmed, sortOrder: nextSortOrder(catalog.categories), stationId };
    void change([{ type: 'category/save', category: saved, isNew: !category }], {
      done: category ? '已更新分類' : `已新增分類 ${trimmed}`,
    }).then((ok) => {
      if (!ok) return;
      if (!category) onCreated(saved.id);
      onClose();
    });
  };

  return (
    <Modal
      title={category ? `編輯 ${category.name}` : '新增分類'}
      onClose={onClose}
      footer={
        <button className="button button-primary button-wide" disabled={busy || !valid} onClick={save}>
          儲存
        </button>
      }
    >
      <label className="field-label" htmlFor="category-name">分類名稱</label>
      <input
        id="category-name"
        className="text-input"
        value={name}
        maxLength={MAX_NAME_LENGTH}
        onChange={(event) => setName(event.target.value)}
      />
      <label className="field-label" htmlFor="category-station">
        預設出餐站<span className="field-hint">這個分類的品項送到哪一站製作</span>
      </label>
      <StationSelect id="category-station" value={stationId} none="未指定" onChange={setStationId} />
    </Modal>
  );
}

const newChoice = (): OptionChoice => ({ id: crypto.randomUUID(), name: '', priceDelta: 0 });
const newGroup = (): OptionGroup => ({
  id: crypto.randomUUID(),
  name: '',
  required: false,
  multiple: false,
  choices: [newChoice()],
});

/** A copy with new ids, so copying the same options twice cannot clash. */
const copyGroup = (group: OptionGroup): OptionGroup => ({
  ...group,
  id: crypto.randomUUID(),
  choices: group.choices.map((choice) => ({ ...choice, id: crypto.randomUUID() })),
});

function trimItem(item: MenuItem): MenuItem {
  return {
    ...item,
    name: item.name.trim(),
    optionGroups: item.optionGroups.map((group) => ({
      ...group,
      name: group.name.trim(),
      choices: group.choices.map((choice) => ({ ...choice, name: choice.name.trim() })),
    })),
  };
}

function ItemEditor({ item, categoryId, onClose }: { item?: MenuItem; categoryId: string; onClose(): void }) {
  const { catalog } = useApp();
  const { busy, change } = useCatalogChange();
  const inCategory = (id: string) => catalog.items.filter((candidate) => candidate.categoryId === id);
  const [draft, setDraft] = useState<MenuItem>(
    () =>
      item ?? {
        id: crypto.randomUUID(),
        categoryId,
        name: '',
        price: Number.NaN,
        sortOrder: nextSortOrder(inCategory(categoryId)),
        optionGroups: [],
      },
  );
  const [showProblems, setShowProblems] = useState(false);
  const problems = menuItemProblems(draft);
  const categoryStation = (id: string) => {
    const stationId = catalog.categories.find((category) => category.id === id)?.stationId;
    return stationId ? stationLabel(catalog.stations, stationId) : '未指定';
  };
  const withOptions = catalog.items.filter(
    (candidate) => candidate.id !== draft.id && candidate.optionGroups.length > 0,
  );

  const setGroup = (index: number, group: OptionGroup) =>
    setDraft((current) => ({
      ...current,
      optionGroups: current.optionGroups.map((candidate, i) => (i === index ? group : candidate)),
    }));
  const removeGroup = (index: number) =>
    setDraft((current) => ({
      ...current,
      optionGroups: current.optionGroups.filter((_, i) => i !== index),
    }));
  const addGroups = (groups: OptionGroup[]) =>
    setDraft((current) => ({ ...current, optionGroups: [...current.optionGroups, ...groups] }));

  const save = () => {
    if (problems.length > 0) {
      setShowProblems(true);
      return;
    }
    const movedCategory = item && item.categoryId !== draft.categoryId;
    const saved = trimItem(
      movedCategory ? { ...draft, sortOrder: nextSortOrder(inCategory(draft.categoryId)) } : draft,
    );
    void change([{ type: 'item/save', item: saved, isNew: !item }], {
      done: item ? `已更新 ${saved.name}` : `已新增 ${saved.name}`,
    }).then((ok) => ok && onClose());
  };

  return (
    <Modal
      title={item ? `編輯 ${item.name}` : '新增品項'}
      onClose={onClose}
      footer={
        <>
          {showProblems && problems.length > 0 && (
            <ul className="warning-note problem-list" role="alert">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          )}
          <button className="button button-primary button-wide" disabled={busy} onClick={save}>
            儲存
          </button>
        </>
      }
    >
      <label className="field-label" htmlFor="item-name">品名</label>
      <input
        id="item-name"
        className="text-input"
        value={draft.name}
        maxLength={MAX_NAME_LENGTH}
        onChange={(event) => setDraft({ ...draft, name: event.target.value })}
      />

      <label className="field-label" htmlFor="item-price">
        價格（元）
        {item && <span className="field-hint">已點的單維持原價</span>}
      </label>
      <input
        id="item-price"
        className="text-input"
        type="number"
        inputMode="numeric"
        min={0}
        step={1}
        value={fromNumber(draft.price)}
        onChange={(event) => setDraft({ ...draft, price: toNumber(event.target.value) })}
      />

      <label className="field-label" htmlFor="item-category">分類</label>
      <select
        id="item-category"
        className="text-input"
        value={draft.categoryId}
        onChange={(event) => setDraft({ ...draft, categoryId: event.target.value })}
      >
        {catalog.categories.map((category) => (
          <option key={category.id} value={category.id}>
            {category.name}
          </option>
        ))}
      </select>

      <label className="checkbox item-no-service">
        <input
          type="checkbox"
          checked={draft.noServiceCharge === true}
          onChange={(event) => setDraft({ ...draft, noServiceCharge: event.target.checked || null })}
        />
        不收服務費
      </label>

      <label className="field-label" htmlFor="item-station">出餐站</label>
      <StationSelect
        id="item-station"
        value={draft.stationId}
        none={`跟隨分類（${categoryStation(draft.categoryId)}）`}
        onChange={(stationId) => setDraft({ ...draft, stationId })}
      />

      <p className="field-label">
        客製選項<span className="field-hint">例如辣度、加料。選項可以加價，也可以填負數折價</span>
      </p>
      {draft.optionGroups.map((group, index) => (
        <OptionGroupEditor
          key={group.id}
          group={group}
          index={index}
          onChange={(next) => setGroup(index, next)}
          onRemove={() => removeGroup(index)}
        />
      ))}
      <div className="option-editor-tools">
        <button className="button button-small" onClick={() => addGroups([newGroup()])}>新增選項組</button>
        {withOptions.length > 0 && (
          <select
            className="text-input copy-options"
            aria-label="複製其他品項的選項"
            value=""
            onChange={(event) => {
              const source = withOptions.find((candidate) => candidate.id === event.target.value);
              if (source) addGroups(source.optionGroups.map(copyGroup));
            }}
          >
            <option value="">複製其他品項的選項…</option>
            {withOptions.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}（{candidate.optionGroups.map((g) => g.name).join('、')}）
              </option>
            ))}
          </select>
        )}
      </div>
    </Modal>
  );
}

function OptionGroupEditor({
  group,
  index,
  onChange,
  onRemove,
}: {
  group: OptionGroup;
  index: number;
  onChange(group: OptionGroup): void;
  onRemove(): void;
}) {
  const setChoice = (choiceIndex: number, choice: OptionChoice) =>
    onChange({ ...group, choices: group.choices.map((c, i) => (i === choiceIndex ? choice : c)) });

  return (
    <fieldset className="option-editor">
      <legend className="visually-hidden">第 {index + 1} 組選項</legend>
      <div className="option-editor-row">
        <input
          className="text-input"
          aria-label={`第 ${index + 1} 組選項名稱`}
          placeholder="選項組名稱，例如辣度"
          value={group.name}
          maxLength={MAX_NAME_LENGTH}
          onChange={(event) => onChange({ ...group, name: event.target.value })}
        />
        <button className="link-button link-danger" onClick={onRemove}>刪除這組</button>
      </div>
      <div className="chip-row">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={group.required}
            onChange={(event) => onChange({ ...group, required: event.target.checked })}
          />
          必選
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={group.multiple}
            onChange={(event) => onChange({ ...group, multiple: event.target.checked })}
          />
          可複選
        </label>
      </div>
      {group.choices.map((choice, choiceIndex) => (
        <div key={choice.id} className="option-editor-row">
          <input
            className="text-input"
            aria-label={`${group.name || `第 ${index + 1} 組`} 第 ${choiceIndex + 1} 個選項`}
            placeholder="選項，例如小辣"
            value={choice.name}
            maxLength={MAX_NAME_LENGTH}
            onChange={(event) => setChoice(choiceIndex, { ...choice, name: event.target.value })}
          />
          <input
            className="text-input price-delta"
            type="number"
            inputMode="numeric"
            step={1}
            aria-label={`${choice.name || `第 ${choiceIndex + 1} 個選項`} 加價`}
            value={fromNumber(choice.priceDelta)}
            onChange={(event) => setChoice(choiceIndex, { ...choice, priceDelta: toNumber(event.target.value) })}
          />
          <button
            className="icon-button"
            aria-label={`刪除 ${choice.name || `第 ${choiceIndex + 1} 個選項`}`}
            onClick={() => onChange({ ...group, choices: group.choices.filter((_, i) => i !== choiceIndex) })}
          >
            ×
          </button>
        </div>
      ))}
      <button
        className="link-button"
        onClick={() => onChange({ ...group, choices: [...group.choices, newChoice()] })}
      >
        ＋ 新增選項
      </button>
    </fieldset>
  );
}

function DeleteItemDialog({ item, onClose }: { item: MenuItem; onClose(): void }) {
  const { busy, change } = useCatalogChange();
  return (
    <Modal
      title={`刪除 ${item.name}`}
      onClose={onClose}
      footer={
        <button
          className="button button-danger button-wide"
          disabled={busy}
          onClick={() =>
            void change([{ type: 'item/delete', id: item.id }], {
              done: `已刪除 ${item.name}`,
              failure: '刪除失敗',
            }).then((ok) => ok && onClose())
          }
        >
          確認刪除
        </button>
      }
    >
      <p>刪除後顧客和員工都不能再點這個品項，已點的單不受影響。</p>
      <p className="warning-note">只是今天賣完的話，請改用「售完管理」，明天就能直接恢復。</p>
    </Modal>
  );
}
