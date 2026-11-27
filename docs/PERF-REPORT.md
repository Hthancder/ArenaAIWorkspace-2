# HolySic — Benchmark hiệu năng (Phase 12)

Đo bằng `scripts/perf-bench.js` trên bản web preview (Chromium headless, 390×844), bộ đếm dev trong
`src/services/perfProbe.ts` (chỉ bật khi bench đặt `globalThis.__HS_PERF__`; bản phát hành chỉ tốn một phép
kiểm tra boolean). Mỗi kịch bản đo 8 giây; số liệu là **trên mỗi giây**.

> Lưu ý: trên web, các animation "native driver" chạy bằng JS nên `commit:all` / `scriptMs` của web
> cao hơn iPhone. Các số đáng tin để suy ra iPhone là: số lần render component, số sự kiện phổ âm
> (spectrum) qua cầu JS, số lệnh `setValue` gửi sang UI thread, và độ trễ chuyển dòng lời.

## Các vấn đề tìm thấy

| # | Vấn đề | Ảnh hưởng |
|---|--------|-----------|
| 1 | **Phổ âm vẫn chạy khi app ở nền / khoá màn hình** nếu để trình phát mở (FullPlayer + thanh Poster không có chặn AppState). Native timer 60 lần/s → JS → 64 `setValue`/khung | Đây là nguyên nhân chính khiến **máy lag và thao tác ngoài app bị giật khi đang nghe** |
| 2 | Chỉ số dòng lời (`activeLyricIndex`) nằm trong context toàn app | Mỗi lần đổi dòng (2–5 s) **toàn bộ app re-render**: Home, Tab bar, nền, mini player, mọi TrackRow — đúng lúc lời cần chuyển |
| 3 | Lời chỉ theo đồng hồ vị trí 4 lần/s | Chuyển dòng trễ 0–250 ms tuỳ nhịp, cộng thêm spring 0,6 s mới "vào chỗ" |
| 4 | Provider re-render mỗi 10 s (lưu phiên nghe) | Chạy lại toàn bộ thân Provider ~3000 dòng |
| 5 | Ánh sáng ambient tạo **một animation native mới cho mỗi sự kiện phổ** (30/s) | 3 lệnh qua cầu mỗi lần |
| 6 | Thanh phổ Poster gửi 32×2 `setValue` mỗi khung kể cả khi không đổi; luôn 60 fps khi mở trình phát (kể cả ở tab Lời / kiểu khác) | Hàng nghìn lệnh/giây |
| 7 | Video MV vẫn đồng bộ 2 lần/s khi app ở nền; thanh "đang phát" vẫn nhảy khi bị trình phát che | CPU/GPU không ai thấy |
| 8 | Widget nhận vị trí **làm tròn xuống 2 s** | Lời trên widget **trễ 0–2 s** so với nhạc |

## Kết quả (cấu hình nặng: Poster + nền Visualizer + thanh phổ dock)

| Kịch bản | Trước | Sau |
|---|---|---|
| Đang phát, **app ở nền**, trình phát để mở — script JS | 108,7 ms/s | **10,4 ms/s** (−90 %) |
| … sự kiện phổ qua cầu | 24,8/s (iPhone: 60/s) | **0** |
| … `setValue` thanh phổ | 169/s (iPhone trước khi lọc: ~3 800/s) | **0** |
| … render MiniPlayer / Lời ở nền | 0,6/s + 0,8/s | **0,1/s / 0** |
| Đang phát, trình phát đóng — render Provider + cả app theo dòng lời | 0,5/s × (Home, TabBar, nền, Mini, ~9 TrackRow) | **0** (chỉ MiniPlayer ticker) |
| Thiết bị native: fps phổ khi trình phát mở nhưng không thấy thanh Poster | 60 | **30** |
| Ambient light: animation mới mỗi sự kiện | 21/s | **1,5–5/s** `setValue` (chỉ khi đổi) |

### Độ chính xác chuyển dòng lời (ms so với lúc dòng bắt đầu, âm = sớm)

| | p10 | p50 | p90 | dao động |
|---|---|---|---|---|
| Cũ (theo đồng hồ, lead 0,15 s) | thay đổi theo lần chạy: −69 … +256 | | | ~0–250 ms |
| **Mới** (hẹn giờ đúng mốc, lead 0,15 s) | **−148** | **−145** | **−131** | **≈ 15 ms** |

Dòng mới sáng lên đúng 0,15 s trước khi hát (đủ cho animation), không còn phụ thuộc nhịp báo vị trí;
animation scale nhanh hơn (spring speed 20, opacity 240 ms) và chỉ những dòng thay đổi mới render lại.

## Widget trên bản TrollStore

* Đã sửa lỗi thật: vị trí gửi cho widget bị làm tròn xuống 2 s → lời widget trễ tới 2 s. Giờ gửi vị
  trí chính xác (ngoại suy từ lần báo cuối), sai lệch cho phép 1,5 s thay vì 3 s.
* Widget đã tự xếp lịch từng dòng/từng chữ trong timeline nên không cần app đánh thức.
* Giới hạn còn lại **là của iOS (WidgetKit/chronod), TrollStore không vượt qua được**: không có
  entitlement nào biến widget thành thời gian thực; mỗi lần app yêu cầu reload (đổi bài, pause) iOS
  thường vẽ lại sau ~0,5–3 s, và iOS có thể gộp các entry quá sát nhau. Khi đang phát nhạc, reload
  không bị tính vào hạn mức nên không bị "đứng" vì hết budget.
* Nếu cần lời thật sự tức thời ngoài app, cách đúng là Live Activity (màn hình khoá / Dynamic Island) —
  chưa làm, chờ bạn quyết.
