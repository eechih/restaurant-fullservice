import qrcode from 'qrcode-generator';
import { useMemo, useState } from 'react';
import { useAction, useApp } from '../appContext';
import type { DiningTable } from '../domain';
import { Modal } from '../ui/Modal';

function customerUrl(tableToken: string) {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}#/order/${encodeURIComponent(tableToken)}`;
}

function QrCode({ value, label }: { value: string; label: string }) {
  const { size, path } = useMemo(() => {
    const code = qrcode(0, 'M');
    code.addData(value);
    code.make();
    const count = code.getModuleCount();
    let modules = '';
    for (let row = 0; row < count; row += 1) {
      for (let column = 0; column < count; column += 1) {
        if (code.isDark(row, column)) modules += `M${column} ${row}h1v1h-1z`;
      }
    }
    return { size: count, path: modules };
  }, [value]);
  const quietZone = 4;
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`${-quietZone} ${-quietZone} ${size + quietZone * 2} ${size + quietZone * 2}`}
    >
      <rect x={-quietZone} y={-quietZone} width={size + quietZone * 2} height={size + quietZone * 2} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}

export function QrCodesPage() {
  const { catalog, can } = useApp();
  const isManager = can('settings');
  const [rotating, setRotating] = useState<DiningTable>();
  const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  const tables = catalog.tables;

  return (
    <div>
      <div className="qr-toolbar no-print">
        <h1 className="section-title">桌位 QR Code</h1>
        <button className="button" onClick={() => window.print()}>列印</button>
      </div>
      <p className="field-hint no-print qr-hint">顧客掃碼點的單會先出現在外場的「掃碼點餐待確認」，服務員確認後才會送廚。</p>
      {isLocal && (
        <p className="warning-note no-print">
          目前的網址是本機位址，手機掃描後無法開啟。正式列印請在部署後的網站操作。
        </p>
      )}
      <div className="qr-grid">
        {tables.map((table) => (
          <section key={table.id} className="qr-card" aria-label={`${table.name} QR Code`}>
            <h2>{table.name}</h2>
            {table.qrToken ? (
              <>
                <QrCode value={customerUrl(table.qrToken)} label={`${table.name} 點餐 QR Code`} />
                <div className="qr-card-tools no-print">
                  <a className="link-button" href={customerUrl(table.qrToken)} target="_blank" rel="noreferrer">
                    開啟點餐頁
                  </a>
                  {isManager && (
                    <button className="link-button" onClick={() => setRotating(table)}>
                      重新產生
                    </button>
                  )}
                </div>
              </>
            ) : (
              <>
                <p className="empty-note">這張桌子還沒有 QR Code</p>
                {isManager ? <GenerateButton table={table} /> : <p className="field-hint no-print">請店長產生</p>}
              </>
            )}
          </section>
        ))}
      </div>
      {rotating && <RotateDialog table={rotating} onClose={() => setRotating(undefined)} />}
    </div>
  );
}

function GenerateButton({ table }: { table: DiningTable }) {
  const { actions } = useApp();
  const { busy, run } = useAction();
  return (
    <button
      className="button button-primary no-print"
      disabled={busy}
      onClick={() => run(() => actions.rotateTableToken(table.id), '產生 QR Code 失敗')}
    >
      產生 QR Code
    </button>
  );
}

function RotateDialog({ table, onClose }: { table: DiningTable; onClose(): void }) {
  const { actions, notify } = useApp();
  const { busy, run } = useAction();
  const rotate = () =>
    run(async () => {
      await actions.rotateTableToken(table.id);
      notify(`${table.name} 的 QR Code 已更新，請重新列印`);
      onClose();
    }, '重新產生失敗');
  return (
    <Modal
      title={`重新產生 ${table.name} 的 QR Code`}
      onClose={onClose}
      footer={
        <button className="button button-danger button-wide" disabled={busy} onClick={rotate}>
          確認重新產生
        </button>
      }
    >
      <p className="warning-note">舊的 QR Code 會立刻失效，必須重新列印並更換桌上的 QR Code。</p>
    </Modal>
  );
}
