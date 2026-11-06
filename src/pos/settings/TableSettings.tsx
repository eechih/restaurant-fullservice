import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useApp } from '../../appContext';
import { MAX_NAME_LENGTH, MAX_PARTY_SIZE, moveBy, nextSortOrder, pendingOrders, zonesOf, type DiningTable } from '../../domain';
import { Modal } from '../../ui/Modal';
import { MoveButtons, useCatalogChange } from './MenuSettings';

const MAX_SEATS = MAX_PARTY_SIZE;

export function TableSettings() {
  const { catalog, live } = useApp();
  const { busy, change } = useCatalogChange();
  const [editing, setEditing] = useState<DiningTable | 'new'>();
  const [deleting, setDeleting] = useState<DiningTable>();
  const tables = catalog.tables;

  /** Why a table cannot be deleted right now, if anything stops it. */
  const inUse = (table: DiningTable) => {
    if (live.state.seatings[table.id]) return '有客人或待清理，空桌後才能刪除';
    if (pendingOrders(live.state, Date.now()).some((order) => order.tableId === table.id)) {
      return '有待確認的掃碼點餐，處理完才能刪除';
    }
    return undefined;
  };

  return (
    <section className="settings-panel table-settings" aria-label="桌位">
      <div className="settings-panel-header">
        <h2>桌位</h2>
        <button className="button button-small button-primary" onClick={() => setEditing('new')}>新增桌位</button>
      </div>
      <p className="field-hint settings-hint">
        新增的桌位會自動產生 QR Code，請到 <Link to="/pos/qr">QR Code</Link> 頁列印。改名不影響已印好的 QR Code。
        分區可以填一樓、二樓、包廂等，外場畫面可以依分區篩選。
      </p>
      {tables.length === 0 && <p className="empty-note">還沒有桌位</p>}
      <ul className="settings-list">
        {tables.map((table) => {
          const reason = inUse(table);
          return (
            <li key={table.id}>
              <div className="settings-list-name">
                {table.name}
                <span className="field-hint">
                  {table.zone ? `${table.zone}・` : ''}
                  {table.seats} 人座
                </span>
              </div>
              <MoveButtons
                label={table.name}
                disabled={busy}
                onMove={(offset) => {
                  const moved = moveBy(tables, table.id, offset);
                  if (!moved) return;
                  void change(
                    moved.map((record) => ({ type: 'table/save', table: record, isNew: false })),
                    { failure: '調整順序失敗' },
                  );
                }}
              />
              <button className="link-button" onClick={() => setEditing(table)}>編輯</button>
              <button
                className="link-button link-danger"
                disabled={Boolean(reason)}
                title={reason}
                onClick={() => setDeleting(table)}
              >
                刪除
              </button>
            </li>
          );
        })}
      </ul>
      {editing && (
        <TableDialog table={editing === 'new' ? undefined : editing} onClose={() => setEditing(undefined)} />
      )}
      {deleting && <DeleteTableDialog table={deleting} onClose={() => setDeleting(undefined)} />}
    </section>
  );
}

function TableDialog({ table, onClose }: { table?: DiningTable; onClose(): void }) {
  const { catalog } = useApp();
  const { busy, change } = useCatalogChange();
  const [name, setName] = useState(table?.name ?? '');
  const [seats, setSeats] = useState(String(table?.seats ?? 4));
  const [zone, setZone] = useState(table?.zone ?? '');
  const zones = zonesOf(catalog.tables);
  const trimmed = name.trim();
  const seatCount = Number(seats);
  const duplicate = catalog.tables.some((other) => other.id !== table?.id && other.name === trimmed);
  const problem = !trimmed
    ? '請輸入桌名'
    : duplicate
      ? '已經有同名的桌位'
      : !Number.isInteger(seatCount) || seatCount < 1 || seatCount > MAX_SEATS
        ? `座位數要是 1 到 ${MAX_SEATS} 的整數`
        : undefined;

  const save = () => {
    const zoneName = zone.trim().slice(0, MAX_NAME_LENGTH) || null;
    const saved: DiningTable = table
      ? { ...table, name: trimmed, seats: seatCount, zone: zoneName }
      : {
          id: crypto.randomUUID(),
          name: trimmed,
          seats: seatCount,
          zone: zoneName,
          sortOrder: nextSortOrder(catalog.tables),
          qrToken: crypto.randomUUID(),
        };
    void change([{ type: 'table/save', table: saved, isNew: !table }], {
      done: table ? `已更新 ${trimmed}` : `已新增 ${trimmed}`,
    }).then((ok) => ok && onClose());
  };

  return (
    <Modal
      title={table ? `編輯 ${table.name}` : '新增桌位'}
      onClose={onClose}
      footer={
        <>
          {problem && trimmed && <p className="warning-note">{problem}</p>}
          <button className="button button-primary button-wide" disabled={busy || Boolean(problem)} onClick={save}>
            儲存
          </button>
        </>
      }
    >
      <label className="field-label" htmlFor="table-name">桌名<span className="field-hint">例如 A1、窗邊 2</span></label>
      <input
        id="table-name"
        className="text-input"
        value={name}
        maxLength={MAX_NAME_LENGTH}
        onChange={(event) => setName(event.target.value)}
      />
      <label className="field-label" htmlFor="table-seats">座位數</label>
      <input
        id="table-seats"
        className="text-input"
        type="number"
        inputMode="numeric"
        min={1}
        max={MAX_SEATS}
        step={1}
        value={seats}
        onChange={(event) => setSeats(event.target.value)}
      />
      <label className="field-label" htmlFor="table-zone">
        分區<span className="field-hint">選填</span>
      </label>
      <input
        id="table-zone"
        className="text-input"
        list="table-zones"
        value={zone}
        maxLength={MAX_NAME_LENGTH}
        placeholder="例如：一樓"
        onChange={(event) => setZone(event.target.value)}
      />
      <datalist id="table-zones">
        {zones.map((candidate) => (
          <option key={candidate} value={candidate} />
        ))}
      </datalist>
    </Modal>
  );
}

function DeleteTableDialog({ table, onClose }: { table: DiningTable; onClose(): void }) {
  const { busy, change } = useCatalogChange();
  return (
    <Modal
      title={`刪除 ${table.name}`}
      onClose={onClose}
      footer={
        <button
          className="button button-danger button-wide"
          disabled={busy}
          onClick={() =>
            void change([{ type: 'table/delete', id: table.id }], {
              done: `已刪除 ${table.name}`,
              failure: '刪除失敗',
            }).then((ok) => ok && onClose())
          }
        >
          確認刪除
        </button>
      }
    >
      <p className="warning-note">這張桌子的 QR Code 會立刻失效，請把桌上的 QR Code 收掉。</p>
    </Modal>
  );
}
