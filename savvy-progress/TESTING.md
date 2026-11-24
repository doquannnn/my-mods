# Kiểm tra trên máy thật

Những điểm test tự động không kiểm chứng được, cần chạy trên Claude Code thật (app desktop) trước khi merge.

## Dùng bản trong thư mục này

Marketplace `my-mods` được cài từ chính thư mục repo này (nguồn `directory`), nên Claude Code đọc plugin thẳng từ code trên máy, kể cả khi nhánh chưa merge.

1. Cài một lần (nếu `my-mods` đang trỏ về GitHub thì gỡ marketplace đó trước):
   ```bash
   claude plugin marketplace add /home/doquan/Desktop/Personal/Applications/my-mods
   ```
   ```bash
   claude plugin install savvy-progress@my-mods
   ```
2. Kiểm tra: `claude plugin list` phải ghi `Read from: .../my-mods/savvy-progress` và đúng version trong `.claude-plugin/plugin.json`.
3. Sửa code xong thì mở phiên Claude mới (hoặc `/restart`) để nạp bản mới.

## 0.6.1: lệnh nền và subagent bị bỏ dở

Bug: lệnh nền "Wait for loop render completion" (do subagent `general-purpose` chạy) vẫn hiện đang chạy sau khi Claude bị tắt vì thiếu RAM và mở lại.

Theo log phiên: lệnh này chạy ở tiền cảnh với `timeout` 560 giây, sau 180 giây thì Claude tự chuyển nó sang chạy nền (task `bt5a1aoda`). Ảnh chụp lúc 43m54s là bản 0.6.0, khi chưa có phần sửa. Hai test `a moved-to-background wait …` mô phỏng đúng trường hợp này, và chúng hỏng khi bỏ phần sửa.

Cách sửa (trong `hooks/register.tsx`):

1. Khi một lượt chat kết thúc (`classic.Stop`, `classic.SubagentStop`), lệnh nền không còn trong `background_tasks` thì đánh dấu `stopped: no longer running` (hàm `reconcile`).
2. Lệnh nền quá `timeout` của chính nó (mặc định 30 phút) thì đánh dấu `stopped: past its timeout` (trong `tick`).
3. Subagent còn "running" được đối chiếu với `$.agent.list()` khi lượt chat kết thúc và mỗi 15 giây (hàm `reconcileAgents`).

### Chưa kiểm chứng

- [x] **Mã task có khớp không.** Giả định: `id` trong `background_tasks` trùng với `backgroundTaskId` mà Bash trả về. Dự phòng: so khớp theo nội dung lệnh. Nếu cả hai đều không khớp, một lệnh nền **còn sống** sẽ bị đánh dấu `stopped` nhầm khi lượt chat kết thúc.
  Đã thử trên Claude Code v2.1.330 (24/11/2026), bằng một plugin nhỏ ghi lại hai giá trị này trong một lượt `claude -p` chạy `sleep 90` nền: Bash trả `backgroundTaskId: "bs8q5axyt"`; khi lượt kết thúc, `background_tasks` có `{ id: "bs8q5axyt", type: "shell", status: "running", command: "sleep 90" }`. Lệnh xong thì danh sách rỗng. Mã khớp.
- [ ] **Subagent nền không bị đánh dấu lỗi nhầm.** Giả định: `$.agent.list()` vẫn liệt kê subagent chạy nền với trạng thái `running`, `waiting` hoặc `idle` trong lúc nó chạy.
- [ ] **Lệnh đang kẹt được dọn** sau khi cập nhật plugin và có một lượt chat kết thúc.

### Cách thử

1. **Lệnh nền còn sống không bị dọn nhầm.** Nhờ Claude chạy một lệnh nền dài, ví dụ `sleep 300` với `run_in_background`. Hỏi thêm một câu cho lượt chat kết thúc. Mở `/savvy-progress`: lệnh phải vẫn là `◌` (chạy nền). Nếu nó thành `–` với `stopped: no longer running` thì là lỗi mã task không khớp.
2. **Lệnh nền chết được dọn.** Trong lúc lệnh nền ở bước 1 còn chạy, thoát hẳn Claude Code rồi mở lại phiên (`claude --resume` hoặc mở lại trong app). Hỏi một câu. Lệnh phải thành `–` với `stopped: no longer running` (bấm `▾` để xem).
3. **Subagent nền không bị đánh dấu lỗi nhầm.** Nhờ Claude chạy 2–3 subagent nền (mặc định Agent chạy nền). Trong lúc chúng chạy, hỏi thêm câu khác. Sau 15 giây và sau khi lượt chat kết thúc, các subagent đó phải vẫn đang chạy, không thành `✗ no longer running`.
4. **Subagent chết được dọn.** Thoát Claude Code khi subagent đang chạy, mở lại, hỏi một câu. Subagent phải thành `✗` với `no longer running`.
5. **Hết timeout.** Nhờ Claude chạy lệnh nền `sleep 200` với `timeout` 60000 (60 giây). Sau khoảng 2 phút, lệnh phải thành `–` với `stopped: past its timeout`.

Nếu bước nào sai, chụp pane (mở `▾` của thẻ đó) gửi lại.

## Đã thấy đúng trên máy thật

- 0.3.0: ảnh nhân vật hiện trên desktop.
- 0.4.1: bỏ `isInteractive` thì ảnh hiện lại (ở 0.4.0 chỉ còn huy hiệu).
- 0.5.0: thẻ một dòng với mũi tên `▾` / `▴`.
- 0.6.0: lệnh có mô tả hiện mô tả.

## Chưa thấy trên máy thật

- Icon có chuyển động không (CSS animation trong `Svg` ở chế độ ảnh), và có bị giật về đầu mỗi giây không.
- Câu tóm tắt Haiku viết cho lệnh không có mô tả (0.6.0).
