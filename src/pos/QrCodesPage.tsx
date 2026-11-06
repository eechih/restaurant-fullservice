import qrcode from 'qrcode-generator';
import { useMemo, useState } from 'react';
import { useAction, useApp } from '../appContext';
import { TAKEOUT_NAME, TAKEOUT_TABLE_ID, type DiningTable } from '../domain';
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
  const { catalog, role } = useApp();
  const isManager = role === 'MANAGER';
  const [rotating, setRotating] = useState<DiningTable>();
  const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  const takeout = catalog.tables.find((table) => table.id === TAKEOUT_TABLE_ID);
  // The takeout code goes on the counter, so it comes first.
  const tables = takeout ? [takeout, ...catalog.tables.filter((table) => table !== takeout)] : catalog.tables;

  return (
    <div>
      <div className="qr-toolbar no-print">
        <h1 className="section-title">桌位 QR Code</h1>
        <button className="button" onClick={() => window.print()}>列印</button>
      </div>
      {isLocal && (
        <p className="warning-note no-print">
          目前的網址是本機位址，手機掃描後無法開啟。正式列印請在部署後的網站操作。
        </p>
      )}
      {!takeout && isManager && <CreateTakeoutEntry />}
      <div className="qr-grid">
        {tables.map((table) => (
          <section key={table.id} className="qr-card" aria-label={`${table.name} QR Code`}>
            <h2>{table.id === TAKEOUT_TABLE_ID ? '外帶點餐' : table.name}</h2>
            {table.id === TAKEOUT_TABLE_ID && <p className="field-hint qr-card-hint">貼在櫃台或門口，掃碼點外帶</p>}
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

function CreateTakeoutEntry() {
  const { actions, notify } = useApp();
  const { busy, run } = useAction();
  const create = () =>
    run(async () => {
      await actions.changeCatalog([
        {
          type: 'table/save',
          table: { id: TAKEOUT_TABLE_ID, name: TAKEOUT_NAME, seats: 0, sortOrder: -1, qrToken: crypto.randomUUID() },
          isNew: true,
        },
      ]);
      notify('已建立外帶入口');
    }, '建立外帶入口失敗');
  return (
    <div className="warning-note no-print takeout-setup">
      <span>還沒有外帶入口。建立後，櫃台可以點外帶，顧客也能掃碼點外帶。</span>
      <button className="button button-small button-primary" disabled={busy} onClick={create}>
        建立外帶入口
      </button>
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
