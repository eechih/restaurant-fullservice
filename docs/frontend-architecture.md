# 前端架構擴展方向

- **狀態：** Router 與 Query 已導入
- **決定日期：** 2026-11-05

## 決定

功能擴展時，**優先導入 TanStack Router 與 TanStack Query**，完成後再開發新領域的功能。

- 保留 `Repository`，作為 Query 的資料來源。
- POS/KDS 的即時狀態繼續由 `useLiveState` 管理，不搬進 Query。

## 導入時機

[顧客掃碼點餐](qr-ordering.md)需要不必登入的顧客端入口和請求式資料，因此在開發該功能前先導入。

## 背景

導入前的做法在兩個主畫面的規模下夠用，但擴展時會遇到這些問題：

| 當時的做法 | 位置 | 擴展時的問題 |
|---|---|---|
| 手寫 hash 路由，用正規表達式解析參數 | `src/App.tsx`、`src/pos/PosPage.tsx` | 參數沒有型別，也沒有巢狀版面、路由守衛和頁面級 code splitting |
| 目錄用 `useState` 手動載入 | `src/App.tsx` | 每種請求式資料都要重寫載入、失敗和快取邏輯 |
| 所有狀態放在同一個 `AppContext` | `src/appContext.ts` | 任何變動都會重新渲染所有 `useApp()` 的元件 |
| 手動管理寫入狀態 | `useAction`（`src/appContext.ts`） | 每個新動作都要自行串接 `busy`、錯誤提示和本地更新 |

## 各層職責

| 層 | 負責 | 工具 |
|---|---|---|
| 路由 | 目前頁面、URL 參數、頁面載入、權限守衛 | TanStack Router |
| 請求式伺服器狀態 | 快取、載入狀態、重新抓取、mutation 狀態 | TanStack Query |
| 即時伺服器狀態 | 快照加事件同步 | `useLiveState` |
| 資料來源 | 後端合約，以及 Amplify 和 demo 兩種實作 | `Repository` |
| 本地狀態 | 尚未送廚的點餐草稿、toast | React state 或 client store |

頁面和 Query 都只透過 `Repository` 取得資料，不直接呼叫 Amplify SDK。

## 為什麼這樣決定

**為什麼保留 `Repository`：** Query 管的是資料取回後如何快取，不管資料從哪裡來。拿掉 `Repository` 會失去不需要 AWS 的 demo 模式，以及用記憶體 storage 測試業務流程的能力。

**為什麼 `useLiveState` 不搬進 Query：** 它必須暫存載入期間收到的事件，再重播到快照上，否則較新的事件可能被較舊的快照蓋掉（見 `src/data/useLiveState.ts`）。Query 不提供這個機制，搬過去仍要自己寫，還要多處理它和 refetch 的競爭。

**沒有採用的方案：**

- **繼續手寫：** 頁面和請求式資料變多後，等於自己重寫一套較不完整的路由和快取。
- **只導入 Query：** 報表和後台頁面需要的 URL 篩選條件、權限守衛，仍然要手寫。

## 目前的結構

| 網址 | 路由檔案（`src/routes/`） | 頁面 | 誰可以用 |
|---|---|---|---|
| `#/` | `index.tsx` | 轉址到 `#/pos` | 所有人 |
| `#/pos` | `_staff.pos.index.tsx` | `FloorView`：桌位、候位、待確認、取消申請、可上菜、請結帳 | 店長、主管、櫃台、服務員 |
| `#/pos/table/$tableId` | `_staff.pos.table.$tableId.tsx` | `TableView`：點餐、帳單、結帳 | 同上 |
| `#/pos/reservations` | `_staff.pos.reservations.tsx` | `ReservationsPage`，電話訂位 | 店長、主管、櫃台 |
| `#/receipt/$checkId` | `_staff.receipt.$checkId.tsx` | `ReceiptPage`，列印收據 | 店長、主管、櫃台 |
| `#/kds` | `_staff.kds.tsx` | `KdsPage`，可選出餐站 | 店長、主管、廚房 |
| `#/expo` | `_staff.expo.tsx` | `ExpoPage`，出菜口 | 店長、主管、服務員、廚房 |
| `#/pos/availability` | `_staff.pos.availability.tsx` | `AvailabilityPage` | 店長、主管、廚房 |
| `#/pos/qr` | `_staff.pos.qr.tsx` | `QrCodesPage` | 店長 |
| `#/pos/settings/menu`、`stations`、`tables`、`staff`、`store` | `_staff.pos.settings.*.tsx` | 菜單、出餐站、桌位、員工帳號、店家 | 店長 |
| `#/pos/settings/report`、`kitchen` | `_staff.pos.settings.report.tsx`、`kitchen.tsx` | 日結報表、出餐分析 | 店長、主管 |
| `#/order/$tableToken` | `order.$tableToken.index.tsx` | 顧客菜單（`MenuPage`） | 顧客，不需登入 |
| `#/order/$tableToken/$orderId` | `order.$tableToken.$orderId.tsx` | 顧客訂單狀態（`OrderStatusPage`） | 顧客，不需登入 |

- **`_staff` 版面：** 員工頁面都掛在這層底下。它透過 `src/staffApp.tsx` 按需載入後端實作、登入介面和 `App`，所以顧客端不會下載這些程式碼，新增員工頁面時也要放在這層底下。
- **角色：** `AmplifyRoot` 從 access token 的 `cognito:groups` 取出角色，放進 `useApp().roles`，頁面用 `useApp().can(權限)` 判斷。前端只用它決定顯示哪些頁面和按鈕，真正的限制在後端的授權規則。`App` 的 `NAV` 決定每個角色看得到的頁面，打開沒有權限的頁面會轉到第一個有權限的頁面。
- **網址：** 使用 hash history，靜態託管不需要 rewrite 設定。
- **`src/routeTree.gen.ts`：** 由 Vite 外掛產生，要 commit，因為 `npm run build` 會先跑 `tsc`，但不要手動修改。
- **目錄資料：** `src/data/catalogQuery.ts` 取代了手動載入。`AppContext` 的 `catalog` 和 `catalogState` 由它推導，現有畫面不用改。
- **`networkMode: 'always'`：** demo 模式讀的是瀏覽器儲存空間，所以 query 不能因為離線而暫停。

## 新功能的做法

- 頁面放 `src/routes/`，其餘程式碼放 `src/features/<領域>/`。
- 請求式資料用 Query，並把 query 定義放在該領域內。
- 既有的 `Actions` 不必一次改完，修改到時再逐步換成 `useMutation`。

```ts
// src/features/reports/queries.ts
export const salesQuery = (repository: ReportRepository, range: DateRange) =>
  queryOptions({
    queryKey: ['reports', 'sales', range],
    queryFn: () => repository.getSales(range),
  });

// src/routes/_staff.reports.sales.tsx
export const Route = createFileRoute('/_staff/reports/sales')({
  validateSearch: salesSearchSchema,
  component: SalesReportPage,
});

function SalesReportPage() {
  const { range } = Route.useSearch();
  const { repositories } = useApp();
  const { data } = useQuery(salesQuery(repositories.reports, range));
  // ...
}
```

員工端的 repository 是登入層載入後才存在，所以由 `useApp()` 取得，不放進 Router context，也不在路由的 `loader` 裡使用。範例中的 `ReportRepository` 和 `repositories` 是拆分後才會有的名稱，見下一節。

## 之後視情況調整

這些不屬於這次決定，等出現對應的狀況再處理：

| 狀況 | 調整 |
|---|---|
| 新領域開始加入，`Repository` 變大 | 按領域拆成小介面，由 `repositories` 物件統一注入 |
| `AppContext` 造成明顯的效能問題 | 把 `useLiveState` 改成外部 store，透過 `useSyncExternalStore` 加 selector 訂閱，`applyEvent` 不用改 |
| 結帳開始涉及折扣、發票或金流 | 把規則和交易移到後端，前端只送出指令 |
| 不再需要 demo 模式，也只有一個後端 | 把 `Repository` 簡化成各領域的 API 函式 |
