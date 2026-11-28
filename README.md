# Duality Reborn — bản port thử nghiệm

Bản này nối logic Duality Client với `duality-injection-core.user.js`. Core chạy từ `document-start`, lưu app và definitions để client nhận lại khi iframe được tạo. Sender dùng phép dò `serializeMsg` của core thay vì chọn ngẫu nhiên method có ba tham số. Logic giao diện và các tính năng của client gốc được giữ lại, nhưng **chưa được xác nhận chạy đầy đủ trên phiên bản game hiện tại**: client gốc vẫn dựa vào nhiều dấu vân tay object/tên nội bộ có thể đã thay đổi.

## Cài đặt và kiểm tra

1. Trong Tampermonkey hoặc trình quản lý userscript tương thích, tạo script mới và dán nội dung **`duality-reborn.user.js`**, rồi lưu. Bản này đã nhúng core; không cần cài hai file gốc. Tắt các bản Duality và Injection Core khác để tránh hook đè nhau.
2. Mở lại `https://survev.io/` từ đầu (không chỉ kích hoạt script sau khi trang đã tải). Mặc định dùng **Shift phải** để ẩn/hiện menu Duality.
3. Nếu không chạy, mở Console (F12) và kiểm tra:
   ```js
   window[Symbol.for('duality.injection.core.v1')]?.status()
   ```
   `captured: false` hoặc `state: "timeout"` nghĩa là chưa bắt được game; `definitionsCaptured: false` nghĩa là chưa bắt được definitions. `sender: null` nghĩa là không nhận diện duy nhất sender: các tính năng sửa input sẽ không hoạt động thay vì hook nhầm method. Gửi lại kết quả status, lỗi Console và các bước tái hiện để tiếp tục sửa tương thích.

Chỉ khai báo hỗ trợ `survev.io` và subdomain HTTPS, như core gốc; chưa port/kiểm thử `resurviv.biz`. Script chạy trong page world và giữ nhiều hành vi gốc của client, bao gồm truy cập tài nguyên/dịch vụ bên thứ ba và chức năng webhook tùy chọn. Hãy xem mã và cân nhắc quyền riêng tư, cũng như quy định của game trước khi sử dụng. Code cũ dùng iframe và string timer, nên có thể bị CSP hoặc trình quản lý userscript chặn.

## Phát triển

- `duality_client.js`: bundle gốc, không sửa.
- `duality-injection-core.user.js`: core gốc, thêm hỗ trợ ticker `_ticker` khi không có `ticker`.
- `src/duality-payload.js`: payload gốc được giải đóng gói và điều chỉnh để dùng core.
- `scripts/build.js`: ghép core, launcher gốc và payload thành userscript độc lập.

Cần Node.js, không cần cài package:

```sh
node scripts/build.js
node --test tests/*.test.js
```

Các test dùng mock kiểm tra capture, replay, sender, ticker, cleanup và build; chúng **không thay thế kiểm thử trong trình duyệt và trận đấu thật**. Core tự gỡ hook capture sau 15 giây và chỉ dò sender khi có đúng một method gọi trực tiếp `serializeMsg`; thay đổi game có thể khiến các heuristic này không còn khớp. Việc dispose core không gỡ hết các hook/DOM cũ do payload gốc tạo; tải lại trang để dọn toàn bộ.

### Chẩn đoán ESP / X-ray / aimbot

Sau khi cài bản 0.1.5, vào một trận, bật các tính năng cần thử và chờ vài giây. Trong Console chạy:

```js
JSON.stringify(window[Symbol.for('duality.reborn.diagnostics.v1')]?.status(), null, 2)
```

Báo lại kết quả cùng chế độ chơi (solo/đội), tính năng đã bật và lỗi Console. Snapshot chỉ bao gồm trạng thái hook, cờ tính năng, tên mapping nội bộ, số lượng player và lỗi; không lấy tên hay tọa độ người chơi. Nếu kết quả là `undefined`, gửi cả kết quả `window[Symbol.for('duality.injection.core.v1')]?.status()` và lỗi Console. Aimbot và ESP vẫn phụ thuộc mapping game cũ; không thể đảm bảo đã hoạt động khi chưa kiểm thử trong game thật.

## Đối chiếu mã nguồn Survev

Đối chiếu [survev/survev](https://github.com/survev/survev) tại commit `cf49d323a763115b33d486b31c84ea70761da33d` (26-11-2026, GPL-3.0-or-later):

- [`client/src/game.ts`](https://github.com/survev/survev/blob/cf49d323a763115b33d486b31c84ea70761da33d/client/src/game.ts): `Game.init()` dựng các pool, nhưng player đang điều khiển được gán sau khi nhận dữ liệu. `m_sendMessage` gọi `serializeMsg`.
- [`client/src/objects/player.ts`](https://github.com/survev/survev/blob/cf49d323a763115b33d486b31c84ea70761da33d/client/src/objects/player.ts), [`objectPool.ts`](https://github.com/survev/survev/blob/cf49d323a763115b33d486b31c84ea70761da33d/client/src/objects/objectPool.ts): player nằm trong `playerPool`, thông tin team nằm trong `teamInfo`; pool chứa mảng nội bộ.
- [`client/src/objects/building.ts`](https://github.com/survev/survev/blob/cf49d323a763115b33d486b31c84ea70761da33d/client/src/objects/building.ts), [`map.ts`](https://github.com/survev/survev/blob/cf49d323a763115b33d486b31c84ea70761da33d/client/src/map.ts): nóc được đánh dấu bằng `imgs[].isCeiling`, buildings và obstacles ở các pool riêng, không nhất thiết có tên texture chứa `ceiling`.
- [`client/vite-plugins/codefendPlugin.ts`](https://github.com/survev/survev/blob/cf49d323a763115b33d486b31c84ea70761da33d/client/vite-plugins/codefendPlugin.ts): production đổi tên thuộc tính `m_` bằng tên ngẫu nhiên; không thể giả định tên TypeScript tồn tại nguyên vẹn trên site. Bản port dùng dấu hiệu cấu trúc cho một số mapping và tiếp tục dò sau khi init, nhưng các heuristic còn lại vẫn cần kiểm thử trên bản đang triển khai.

## Injection và rủi ro tài khoản (0.1.5)

So với source ở commit trên, core chặn sender có một lệnh gọi trực tiếp `serializeMsg`, tương ứng với `Game.m_sendMessage`. `MsgType.Input` có giá trị 3 và chứa `inputs`; client chỉ xử lý phần input khi cả hai điều kiện này khớp. Hook Semi Auto không còn tự bật trạng thái bắn ngay lúc khởi động, mà chờ sự kiện nhấn chuột. Core chuyển tiếp nếu handler lỗi trước khi gọi sender; nếu sender đã được gọi thì không gọi lại chỉ vì handler lỗi. **Nếu handler đã sửa object trước khi lỗi, việc chuyển tiếp không tự hoàn tác thay đổi đó.** Lỗi từ sender gốc vẫn được báo.

Các hook che `Function.prototype.toString` và che bộ font trong payload cũ đã bị loại bỏ. Hook method do payload tạo được đăng ký khôi phục khi core dispose nếu chưa bị script khác thay thế. Dispose vẫn không gỡ toàn bộ DOM, event listeners và các hook khác của client gốc; tải lại trang để dọn sạch.

**Không có antiban được bảo đảm.** Source công khai có các nhãn liên quan anti-cheat trong [`shared/net/net.ts`](https://github.com/survev/survev/blob/cf49d323a763115b33d486b31c84ea70761da33d/shared/net/net.ts), xử lý gói lỗi trong [`server/src/game/client.ts`](https://github.com/survev/survev/blob/cf49d323a763115b33d486b31c84ea70761da33d/server/src/game/client.ts), và các chức năng quản lý ban. Source công khai không cho biết toàn bộ cách triển khai, chính sách hoặc kiểm duyệt của máy chủ thực tế; aimbot/X-ray và các tính năng sửa input có thể vi phạm quy định và dẫn đến khóa tài khoản. Muốn tránh rủi ro đó, không sử dụng chúng trên máy chủ không cho phép.
