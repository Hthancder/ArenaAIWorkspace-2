# Cách làm việc trên HolySic: hướng dẫn cho AI

Tài liệu này mô tả cách làm việc đã dùng qua các phase của HolySic, cách mà chủ dự án thấy hiệu
quả. Mọi AI làm việc trên repo này nên đọc hết trước khi sửa code.

> Phong cách chung cho mọi dự án: [`AI-WORKING-STYLE.md`](AI-WORKING-STYLE.md). Tệp này là phần riêng của HolySic.
>
> **Thứ tự ưu tiên:** `AGENTS.md` (các hard rule về credit và license) > yêu cầu của người dùng >
> tài liệu này > thói quen mặc định của bạn. **Không bao giờ sửa `AGENTS.md`.** Phần credit trong
> `README.md` (các khối `mochy-credit`) phải giữ nguyên.

---

## 1. Nguyên tắc gốc

1. **Không đánh đổi.** Mỗi thay đổi phải tốt cho cả hiệu năng, cảm giác native và UX cùng lúc.
   Nếu một cải tiến làm chậm app, làm xấu giao diện hay làm mất một tính năng thì chưa xong. Hãy
   tìm cách khác. Ví dụ đã chủ động *không* làm: hạ FPS mặc định của visualizer hoặc throttle
   thanh nhạc ở dock. Cả hai nhanh hơn thật nhưng làm xấu đi, nên bị loại.
2. **Làm cho xong, không làm nửa vời.** Tính năng nào cũng có đủ: dữ liệu, logic, UI, phần cài
   đặt, phần dự phòng cho web, phần trợ năng (a11y), song ngữ vi/en, cách xử lý lỗi và thông báo
   rõ ràng cho người dùng.
3. **Hiểu yêu cầu thật, không chỉ chữ.** Ví dụ "MIDI bị nhận là m4a" không chỉ là sửa một bảng
   đuôi tệp. Nguyên nhân gốc là app tin vào đuôi tệp, nên cách sửa là đọc byte đầu tệp, phát từ
   bản sao đúng đuôi, và tự tổng hợp MIDI vì AVPlayer không phát được MIDI.
4. **Làm thêm cái thật sự hữu ích, đúng tinh thần yêu cầu.** Ví dụ "PiP có thể có tính năng hữu
   ích khác" dẫn đến: dòng kế tiếp, tô màu karaoke, bài tiếp theo khi không có lời, nút ±15 giây,
   bấm quay lại thì mở màn hình Lời, 3 kiểu cửa sổ. Không thêm thứ người dùng không cần.
5. **Trung thực về những gì chưa kiểm chứng.** Thứ chỉ thử được trên iPhone thật (native module,
   haptics, widget, PiP iOS…) phải ghi rõ trong báo cáo là *chưa kiểm chứng trên máy*. Không bao
   giờ nói "đã xong, chạy tốt" cho thứ chưa chạy.

## 2. Quy trình cho mỗi yêu cầu (phase)

1. **Tìm hiểu trước khi sửa.** Đọc code liên quan bằng `grep -n` và đọc theo khoảng dòng. Tìm
   pattern có sẵn để theo, ví dụ module native mới theo mẫu `modules/holysic-dsp` (podspec,
   `expo-module.config.json`, `requireOptionalNativeModule`). Đừng phát minh lại thứ repo đã có:
   `Tap`, `NativeMenu`, `ToastStore`, `PlaybackClock`, `LyricClock`, `themedSheet`, `T as UI`…
2. **Lập kế hoạch theo lớp:** types → prefs → services → context → UI → settings → web fallback.
3. **Sửa từng bước nhỏ, kiểm tra ngay.** Chạy `npx tsc --noEmit -p .` sau mỗi cụm thay đổi.
   Không để lỗi dồn lại.
4. **Kiểm chứng thật trên web** (xem mục 5): chụp màn hình, đọc DOM, đo số liệu. Không đoán.
5. **Tự rà soát lại toàn bộ diff** trước khi báo cáo, nhất là code không biên dịch được ở đây
   (Swift, ObjC). Đọc từng dòng, tìm lỗi luồng (thread), lỗi vòng đời, chi phí ẩn và trường hợp
   biên.
6. **Format, kiểm tra, commit, báo cáo** (mục 6, 7).

## 3. Hiệu năng: quy tắc bắt buộc

- **Trạng thái thay đổi nhanh không được nằm trong context React toàn app.** Vị trí phát ở
  `PlaybackClock`, dòng lời đang hát ở `LyricClock`, toast ở `ToastStore`. Component chỉ subscribe
  đúng thứ nó cần qua `useSyncExternalStore`.
- **Bridge chạy nền tách thành component riêng trả về `null`**, ví dụ `WidgetBridge` và
  `PipBridge` trong `App.tsx`, để vị trí phát không làm render lại cả app.
- **Gửi ít, gửi khi đổi.** Native chỉ nhận dữ liệu khi có thay đổi (bài, lời, phát/dừng, tua), và
  tự lấy thời gian từ AVPlayer. Không gửi theo từng tick.
- **Không tốn gì khi tính năng chưa dùng.** Ví dụ PiP không vẽ, không tải ảnh bìa, không tạo
  CIContext cho đến lần bật đầu tiên.
- **Việc nặng làm ngoài luồng JS.** Ví dụ MIDI tổng hợp bằng C (`HSMidiSynth.m`) trong
  AsyncFunction; bản TypeScript chỉ là dự phòng.
- **Đo trước và sau** bằng bench (mục 5). Ghi số vào báo cáo. Nhiễu bình thường của kịch bản
  "home playing" khoảng ±15%.

## 4. Native và đa nền tảng

- **Luôn có dự phòng cho web.** Web không có menu native (`nativeMenuAvailable` là false), không
  có module iOS. Mỗi tính năng native cần một bản web tương đương hoặc ẩn đi gọn gàng, ví dụ PiP
  web dùng canvas đưa vào `<video>` rồi gọi Picture-in-Picture của trình duyệt.
- **Module native là tuỳ chọn:** dùng `requireOptionalNativeModule` và hàm optional (`renderMidi?`)
  để bản build cũ hoặc Expo Go không bị crash. Bọc các lệnh gọi native trong `try`.
- **Hai bản cài đặt phải đi cùng nhau.** Bộ tổng hợp MIDI có bản TypeScript (`midiSynth.ts`) và
  bản C (`HSMidiSynth.m`). Mọi thay đổi patch hay gain phải sửa ở **cả hai**, rồi so khớp đầu ra
  (sai lệch tối đa vài đơn vị mẫu).
- **Luồng (thread) trong Swift:** UIKit/AVKit chạy trên main (`.runOnQueue(.main)`). Phần vẽ và
  trạng thái chạy trên một serial queue riêng. Không bao giờ gọi `main.sync` từ queue nền.
- **Tên tệp nguy hiểm** (`#`, `%`, `?`, emoji, dấu tiếng Việt chưa chuẩn hoá NFC): không cắt chuỗi
  ở `#`/`?` với đường dẫn local. Nhận định dạng bằng byte, không bằng tên.

## 5. Kiểm chứng

- **Type check:** `npx tsc --noEmit -p .`. Tìm biến thừa:
  `npx tsc --noEmit -p . --noUnusedLocals | grep <file>`. Repo không có cấu hình ESLint.
- **Web preview:** expo web ở cổng 8081, chạy không có `CI=1` (cờ đó tắt reload), có
  `< /dev/null`. Nếu Metro không thấy thư mục mới thì khởi động lại với `--clear`.
- **Playwright** (chromium headless) để kiểm tra từ đầu đến cuối:
  - Seed dữ liệu qua `localStorage` trong `addInitScript`, ví dụ `@holysic/playlists_v1`.
  - Chọn phần tử bằng `getByText` hoặc `[aria-label="…"]`. Tab và toast cần `click({force:true})`.
  - Nhập tệp bằng `page.waitForEvent('filechooser')` rồi `setFiles(...)`.
  - Chụp màn hình rồi **xem ảnh thật**. Đọc `document.body.innerText` để kiểm tra thứ tự và nội
    dung. Kiểm tra `audio.currentTime` tăng lên để biết nhạc phát thật.
  - Gắn listener lên sự kiện (`enterpictureinpicture`, `play`, `error`…) để tìm nguyên nhân khi
    có lỗi, thay vì đoán.
- **Bench hiệu năng:** `scripts/perf-bench.js` (các kịch bản idle, home playing, cover, lyrics,
  background). So với số của phase trước trong `docs/PERF-REPORT.md`.
- **Harness cho thuật toán thuần** (ví dụ synth): viết script node nhỏ trong `/tmp`, sinh dữ liệu
  thử, so sánh TS với C (gcc), đo cả `node --jitless` để giống Hermes.
- Khi kiểm chứng phát hiện lỗi thật (ví dụ tên `Đêm #1.mid` bị cắt đuôi `.mid` trên web), **sửa
  tận gốc và ghi vào báo cáo**.

## 6. Format, commit, build

- **Prettier** cho các tệp đã sửa (bỏ qua `des.ts` và `RecapModal.tsx`, vốn chưa format từ trước):
  `npx prettier --single-quote --print-width 100 --trailing-comma es5 --write <files>`
- **Commit:** `git add -A -- . ':!.arena' ':!ios'`. Message có dạng
  `Phase N: <tóm tắt>`, thân liệt kê từng nhóm thay đổi. Commit riêng, đừng nối sau
  `prettier --check` (check fail sẽ chặn commit).
- **Chỉ push và build khi người dùng nói "build".** Push lên đúng branch hiện tại, sau đó theo dõi
  CI: `gh run list --branch <br> --limit 3`, rồi `gh run view <id> --json status,conclusion`.
  Workflow `ios-ipa.yml` tạo ra `.tipa` cho TrollStore. Cảnh báo "Node.js 20 is deprecated" là vô
  hại.

## 7. Báo cáo cho người dùng

- **Viết bằng tiếng Việt**, rõ ràng, có cấu trúc theo đúng các mục người dùng yêu cầu.
- Với mỗi mục: **đã làm gì**, **người dùng thấy gì**, và **đã kiểm chứng thế nào** (chụp màn
  hình, số đo).
- Khi rà soát: ghi rõ **lỗi tìm thấy, nguyên nhân, cách sửa**.
- Luôn có phần **"Cần thử trên máy thật"** liệt kê thứ chưa kiểm chứng được.
- Kết thúc bằng trạng thái: commit nào, đã push hay build chưa, bước tiếp theo.
- Ngắn gọn. Không quảng cáo, không phóng đại.

## 8. UI/UX của HolySic

- **Cảm giác native iOS:** menu native khi có, haptic nhẹ (`haptic('light'|'medium'|'selection')`;
  không có `'success'`), animation mượt, `Tap` thay cho `TouchableOpacity`.
- **Màu:** dùng `palette.accent` / `palette.onAccent`. Helper `UI` không có `accent`.
- **Song ngữ:** `const vi = prefs.language === 'vi'`, chuỗi viết theo dạng `vi ? '…' : '…'`.
  Câu chữ tự nhiên, xưng hô thân thiện.
- **Trợ năng:** mọi nút đều có `accessibilityLabel`, có `accessibilityRole`/`State` khi phù hợp.
- **Phần cài đặt:** mỗi tính năng có một thẻ giải thích ngắn gọn nó làm gì và mở ở đâu, kèm hình
  minh hoạ nhỏ khi có lựa chọn kiểu hiển thị.
- **Hooks:** không đặt hook sau `return` sớm (dùng `<Progressive>` hoặc component con). Kiểm tra
  JSX không bị trùng prop trước khi chèn.

## 9. Bẫy đã gặp (đừng lặp lại)

- Ảnh GIF bị làm phẳng khi qua ImagePicker `allowsEditing` hoặc `shrinkImage`: đừng cho GIF/video
  đi qua các bước đó.
- `expo-video` không có kích thước ở cấp trên cùng; dùng `availableVideoTracks[].size`.
- Escape `\` trong heredoc python: dùng raw string.
- Tránh `const enum` và import vòng (ví dụ `midiSynth` ↔ `tagReader`).
- Lời sớm hay trễ: lead của `LyricClock` là 0,15 giây. Đổi thì phải đo lại.
- Muốn PiP web mở được, `<video>` cần có frame trước, nên phải chuẩn bị từ khi nút hiện ra; iOS
  cũng chỉ cho mở PiP ngay trong lúc chạm.
- `CollectionScreen` có `return null` sớm, nên không thêm hook sau đó.
