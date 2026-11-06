import { useState } from 'react';
import { useApp } from '../../appContext';
import { MAX_SERVICE_CHARGE_RATE, settingsProblems, type StoreSettings } from '../../domain';
import { useCatalogChange } from './MenuSettings';

export function StoreSettingsPage() {
  const { catalog } = useApp();
  const { busy, change } = useCatalogChange();
  const [draft, setDraft] = useState<StoreSettings>(catalog.settings);
  const [rateText, setRateText] = useState(String(catalog.settings.serviceChargeRate));
  const settings: StoreSettings = {
    storeName: draft.storeName.trim(),
    taxId: draft.taxId?.trim() || null,
    address: draft.address?.trim() || null,
    phone: draft.phone?.trim() || null,
    serviceChargeRate: rateText.trim() === '' ? Number.NaN : Number(rateText),
  };
  const problems = settingsProblems(settings);
  const field = (key: 'storeName' | 'taxId' | 'address' | 'phone', label: string, hint?: string) => (
    <>
      <label className="field-label" htmlFor={`store-${key}`}>
        {label}
        {hint && <span className="field-hint">{hint}</span>}
      </label>
      <input
        id={`store-${key}`}
        className="text-input"
        value={draft[key] ?? ''}
        inputMode={key === 'taxId' ? 'numeric' : undefined}
        onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
      />
    </>
  );

  return (
    <section className="settings-panel store-settings" aria-label="店家">
      <div className="settings-panel-header">
        <h2>店家</h2>
      </div>
      <p className="field-hint settings-hint">店名、統編、地址和電話會印在收據上。</p>
      {field('storeName', '店名')}
      {field('taxId', '統一編號', '選填')}
      {field('address', '地址', '選填')}
      {field('phone', '電話', '選填')}
      <label className="field-label" htmlFor="store-service-charge">
        服務費（%）
        <span className="field-hint">以折扣後金額計算，填 0 表示不收。只影響之後開桌的帳單</span>
      </label>
      <input
        id="store-service-charge"
        className="text-input"
        type="number"
        inputMode="numeric"
        min={0}
        max={MAX_SERVICE_CHARGE_RATE}
        step={1}
        value={rateText}
        onChange={(event) => setRateText(event.target.value)}
      />
      <p className="field-hint">個別品項可以在「菜單」設定不收服務費，例如酒水或外帶商品。</p>
      {problems.length > 0 && (
        <ul className="warning-note problem-list" role="alert">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
      <button
        className="button button-primary store-save"
        disabled={busy || problems.length > 0}
        onClick={() => void change([{ type: 'settings/save', settings }], { done: '已儲存店家設定' })}
      >
        儲存
      </button>
    </section>
  );
}
