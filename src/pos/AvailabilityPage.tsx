import { useAction, useApp } from '../appContext';
import type { MenuItem } from '../domain';

export function AvailabilityPage() {
  const { catalog } = useApp();
  return (
    <div className="availability">
      <h1 className="section-title">售完管理</h1>
      <p className="field-hint availability-hint">
        設為售完後，顧客和員工都不能再點這個品項。其他裝置最多 1 分鐘內會更新。
      </p>
      {catalog.categories.map((category) => (
        <section key={category.id} className="availability-group" aria-label={category.name}>
          <h2>{category.name}</h2>
          {catalog.items
            .filter((item) => item.categoryId === category.id)
            .map((item) => (
              <AvailabilityRow key={item.id} item={item} />
            ))}
        </section>
      ))}
    </div>
  );
}

function AvailabilityRow({ item }: { item: MenuItem }) {
  const { actions, notify } = useApp();
  const { busy, run } = useAction();
  const soldOut = item.available === false;
  const toggle = () =>
    run(async () => {
      await actions.setItemAvailable(item.id, soldOut);
      notify(soldOut ? `${item.name} 恢復供應` : `${item.name} 已設為售完`);
    }, '更新供應狀態失敗');
  return (
    <div className="availability-row">
      <span className={soldOut ? 'availability-name is-sold-out' : 'availability-name'}>{item.name}</span>
      <button
        aria-pressed={soldOut}
        className={soldOut ? 'chip is-selected' : 'chip'}
        disabled={busy}
        onClick={toggle}
      >
        {soldOut ? '已售完，點此恢復' : '設為售完'}
      </button>
    </div>
  );
}
