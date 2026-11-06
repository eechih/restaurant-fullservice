import { useState } from 'react';
import { useApp } from '../../appContext';
import { MAX_NAME_LENGTH, moveBy, nextSortOrder, type Station } from '../../domain';
import { Modal } from '../../ui/Modal';
import { MoveButtons, useCatalogChange } from './MenuSettings';

export function StationSettings() {
  const { catalog } = useApp();
  const { busy, change } = useCatalogChange();
  const [editing, setEditing] = useState<Station | 'new'>();

  /** What still sends dishes to the station, which must be moved before it is deleted. */
  const usage = (station: Station) =>
    catalog.categories.filter((category) => category.stationId === station.id).length +
    catalog.items.filter((item) => item.stationId === station.id).length;

  return (
    <section className="settings-panel" aria-label="出餐站">
      <div className="settings-panel-header">
        <h2>出餐站</h2>
        <button className="button button-small button-primary" onClick={() => setEditing('new')}>新增出餐站</button>
      </div>
      <ul className="field-hint settings-hint">
        <li>每輪點單送廚時，會依品項拆成各出餐站的工作單，各站在 KDS 只看自己的單。</li>
        <li>在「菜單」為每個分類指定預設出餐站，個別品項可以另外指定。沒有指定的品項會出現在「未指定」。</li>
        <li>出菜口畫面會等同一輪的每個出餐站都完成，才通知服務員上菜。</li>
      </ul>
      {catalog.stations.length === 0 && <p className="empty-note">還沒有出餐站，所有品項會在同一張工作單上</p>}
      <ul className="settings-list">
        {catalog.stations.map((station) => {
          const used = usage(station);
          return (
            <li key={station.id}>
              <div className="settings-list-name">
                {station.name}
                <span className="field-hint">{used > 0 ? `${used} 個分類或品項使用中` : '沒有分類或品項使用'}</span>
              </div>
              <MoveButtons
                label={station.name}
                disabled={busy}
                onMove={(offset) => {
                  const moved = moveBy(catalog.stations, station.id, offset);
                  if (moved) {
                    void change(
                      moved.map((record) => ({ type: 'station/save', station: record, isNew: false })),
                      { failure: '調整順序失敗' },
                    );
                  }
                }}
              />
              <button className="link-button" onClick={() => setEditing(station)}>改名</button>
              <button
                className="link-button link-danger"
                disabled={busy || used > 0}
                title={used > 0 ? '還有分類或品項使用這個出餐站，請先改掉' : undefined}
                onClick={() =>
                  change([{ type: 'station/delete', id: station.id }], {
                    done: `已刪除出餐站 ${station.name}`,
                    failure: '刪除失敗',
                  })
                }
              >
                刪除
              </button>
            </li>
          );
        })}
      </ul>
      {editing && (
        <StationDialog station={editing === 'new' ? undefined : editing} onClose={() => setEditing(undefined)} />
      )}
    </section>
  );
}

function StationDialog({ station, onClose }: { station?: Station; onClose(): void }) {
  const { catalog } = useApp();
  const { busy, change } = useCatalogChange();
  const [name, setName] = useState(station?.name ?? '');
  const trimmed = name.trim();
  const duplicate = catalog.stations.some((other) => other.id !== station?.id && other.name === trimmed);
  const valid = trimmed.length > 0 && trimmed.length <= MAX_NAME_LENGTH && !duplicate;
  const save = () => {
    const saved = station
      ? { ...station, name: trimmed }
      : { id: crypto.randomUUID(), name: trimmed, sortOrder: nextSortOrder(catalog.stations) };
    void change([{ type: 'station/save', station: saved, isNew: !station }], {
      done: station ? '已更新出餐站' : `已新增出餐站 ${trimmed}`,
    }).then((ok) => ok && onClose());
  };
  return (
    <Modal
      title={station ? `${station.name} 改名` : '新增出餐站'}
      onClose={onClose}
      footer={
        <>
          {duplicate && <p className="warning-note">已經有同名的出餐站</p>}
          <button className="button button-primary button-wide" disabled={busy || !valid} onClick={save}>
            儲存
          </button>
        </>
      }
    >
      <label className="field-label" htmlFor="station-name">
        名稱<span className="field-hint">例如熱炒、燒烤、冷盤、飲料吧</span>
      </label>
      <input
        id="station-name"
        className="text-input"
        value={name}
        maxLength={MAX_NAME_LENGTH}
        onChange={(event) => setName(event.target.value)}
      />
    </Modal>
  );
}
