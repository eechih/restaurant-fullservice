# 餐廳 POS + KDS PoC

顧客掃碼點餐、先付款後製作的 POS 與廚房顯示系統（KDS），使用 AWS Amplify Gen 2 + React。

**顧客流程：** 掃碼 → 點餐 → 到櫃台付款 → 廚房製作 → 上菜

**員工代客點餐：** 開桌 → 點餐 → 收款並送廚 → 廚房出餐 → 清桌

**外帶：** 櫃台點餐或顧客掃外帶 QR Code → 收款後給取餐號 → 廚房出餐 → 叫號螢幕通知 → 取餐

## 本機試用（不需要 AWS）

```bash
npm install
npm run dev
```

打開 http://localhost:5173 ，匯入範例資料。把 `#/pos` 和 `#/kds` 開在兩個分頁，就能看到同步。顧客點餐頁可以從 `#/pos/qr` 的「開啟點餐頁」進入。

沒有 `amplify_outputs.json` 時，App 會進入**本機展示模式**：資料存在瀏覽器裡，只會在同一台裝置、同一個瀏覽器的分頁之間同步，也不需要登入。

## 部署到 AWS

需要已設定好的 AWS 憑證。

```bash
npx ampx sandbox
```

這會建立一套個人開發用的 Cognito、AppSync 和 DynamoDB，並產生 `amplify_outputs.json`。App 偵測到這個檔案就會改用 AWS。

公開註冊已關閉，第一個帳號要由管理員建立，並加入店長群組。User Pool ID 在 `amplify_outputs.json` 的 `auth.user_pool_id`：

```bash
aws cognito-idp admin-create-user --user-pool-id <USER_POOL_ID> --username <EMAIL>
aws cognito-idp admin-add-user-to-group --user-pool-id <USER_POOL_ID> --username <EMAIL> --group-name MANAGER
```

Cognito 會寄送臨時密碼，第一次登入時要變更。之後的帳號由店長在「店務設定 → 員工帳號」邀請，不需要再用指令。

> **注意：** 在 sandbox 新增或變更某張表的索引時，Amplify 會**重建那張表並清空資料**，而且預設沒有備份。正式部署不會這樣。

正式部署可將 repo 連接到 Amplify Hosting，會使用 `amplify.yml`。

移除 sandbox 資源：

```bash
npx ampx sandbox delete
```

## 資料模型

| 模型 | 用途 |
|---|---|
| `DiningTable`、`MenuCategory`、`MenuItem` | 桌位與菜單，客製選項內嵌在品項裡；只有店長能修改，員工只能切換售完 |
| `Seating` | 目前哪一桌有人；以 `tableId` 為主鍵 |
| `GuestCheck` | 這桌這次用餐，可以有多筆訂單 |
| `Order` | 一次下單，各自付款；金額由伺服器計算，只由後端函式寫入 |
| `KitchenTicket` | 一次送廚，付款後才由後端函式建立；品項內容寫入後不再變更 |
| `LineVoid` | 品項取消紀錄；帳單金額不含已取消品項 |
| `PickupCounter` | 每個營業日最後發出的外帶取餐號，只由後端函式寫入 |

幾個設計決定：

- **防止重複開桌：** 建立 `Seating` 時，伺服器會檢查該桌的紀錄是否已存在，所以兩人同時開桌只有一人成功。
- **同時加點不互相覆蓋：** 每次送廚和每筆取消都是新紀錄，不會去改同一筆資料。
- **沒付款不會進廚房：** 付款確認是一筆交易，同時更新訂單和建立工作單。
- **金額由伺服器決定：** 下單只送品項和選項，價格由後端依菜單計算。
- **重送不會重複：** 訂單、工作單和取消的 ID 是固定的，網路失敗後重試不會讓廚房多一張單。
- **品項快照：** 名稱、價格和選項在點餐時就存進工作單，之後改菜單不影響既有帳單。
- **斷線補單：** App 在連線恢復時會重新載入完整資料，另外每 60 秒同步一次，以補上斷線期間錯過的事件。

其他設計文件：

- [前端架構擴展方向](docs/frontend-architecture.md)
- [顧客掃碼點餐](docs/qr-ordering.md)
- [試營運計畫](docs/pilot-plan.md)

## 測試

```bash
npm test
npm run typecheck
```

## PoC 的已知限制

正式上線前要處理：

- **權限收回有延遲：** 取消店長或停用帳號後，對方會在所有裝置被登出，但已開啟的畫面在登入憑證到期前（最長 1 小時）仍能操作。
- **退款：** 取消已付款的品項時，員工和顧客都會看到提示，但要手動退款，也沒有留下退款紀錄。
- **濫用防護：** 每桌最多 10 筆未付款訂單，但沒有依來源限制請求頻率。公開上線前應再加 AWS WAF。
- **時間以裝置時鐘為準：** KDS 的等待時間會受各裝置時鐘誤差影響。
- **取消只能取消整筆品項：** 要從 3 份改成 2 份時，需取消後重新點餐。
- **未儲存的點餐：** 尚未送廚的品項只存在該裝置的記憶體，重新整理就會消失。
- **離線：** 斷線時無法收款或送廚，畫面會顯示連線狀態。
