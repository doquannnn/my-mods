# Token Weather

Mod cho Claude Code: vẽ một dải "dự báo thời tiết" ngay phía trên ô nhập prompt, cho biết context window đã dùng bao nhiêu.

```
☂  Showers  67% of context  134.4k / 200k   last turns ▂█  ▲ +98.3k last turn
```

## Mod này thay đổi gì

Chỉ một thứ: thêm một dòng vào vùng `AbovePrompt` (phía trên ô nhập) trong giao diện terminal.

Dòng đó gồm, từ trái sang phải:

| Phần | Ví dụ | Ý nghĩa |
| :- | :- | :- |
| Dự báo | `☂  Showers` | Mức đầy của context, theo bảng bên dưới |
| Phần trăm | `67% of context` | Tỷ lệ context window đã dùng |
| Số token | `134.4k / 200k` | Token đang dùng / kích thước context window |
| Sparkline | `last turns ▂█` | Số token sau mỗi lượt, tối đa 12 lượt gần nhất |
| Xu hướng | `▲ +98.3k last turn` | Chênh lệch token so với lượt trước: `▲ +x`, `▼ x` hoặc `steady` |

Sparkline và xu hướng chỉ hiện khi terminal rộng từ 60 cột trở lên. Xu hướng cần ít nhất 2 lần đo.

### Bảng dự báo

| Context đã dùng | Hiển thị | Màu |
| :- | :- | :- |
| dưới 25% | `☀  Clear` | vàng |
| 25% đến dưới 50% | `☁  Cloudy` | cyan |
| 50% đến dưới 75% | `☂  Showers` | xanh dương |
| 75% đến dưới 90% | `☇  Storm` | magenta |
| từ 90% | `↯  Compact soon` | đỏ |

Sparkline dùng cùng màu với dự báo hiện tại. Chiều cao mỗi cột tính theo lần đo lớn nhất trong lịch sử, không theo kích thước context window.

## Mod này không thay đổi gì

- Không sửa prompt, câu trả lời, tool call hay quyền hạn. Cả ba hook đều gọi `next(e)` và trả nguyên kết quả.
- Không gọi mạng, không ghi file ra đĩa.
- Không thêm slash command, skill, agent hay MCP server.
- Không hiện gì khi chưa có lần đo nào, hoặc khi Claude Code đang hiện khảo sát ở vùng đó (`hasSurvey`).

## Cách hoạt động

Mod đăng ký ba hook trong `hooks/token-weather.mjs`:

| Hook | Khi nào chạy | Làm gì |
| :- | :- | :- |
| `session.start` | Bắt đầu phiên | Đo context một lần |
| `turn.complete` | Xong một lượt của vòng lặp chính | Đo context một lần. Bỏ qua lượt của subagent |
| `ui.render` (`AbovePrompt`) | Mỗi lần vẽ vùng trên ô nhập | Vẽ dải dự báo từ lịch sử đo |

Mỗi lần đo gọi `$.session.usage()` và lưu `{ tokens, window, percent }`. Nếu Claude Code không trả về kích thước context window thì bỏ qua lần đo đó.

Lịch sử nằm trong state `token-weather.readings` do Claude Code giữ, tối đa 12 lần đo gần nhất, nên không mất khi file mod được nạp lại.

## Tùy chỉnh

Sửa các hằng số ở đầu `hooks/token-weather.mjs`:

| Hằng số | Mặc định | Tác dụng |
| :- | :- | :- |
| `HISTORY` | `12` | Số lần đo giữ lại, cũng là độ dài sparkline |
| `BARS` | `▁▂▃▄▅▆▇█` | Các ký tự của sparkline, từ thấp đến cao |
| `FORECAST` | 5 mức | Ngưỡng phần trăm, biểu tượng, chữ và màu của từng mức |

Ngưỡng 60 cột để hiện sparkline nằm trong hàm `band`.

## Cài đặt

Chạy từ thư mục chứa `my-mods/`:

```bash
claude plugin marketplace add ./my-mods
claude plugin install token-weather@my-mods
```

Sau khi sửa code, chạy `/reload-plugins` trong phiên để nạp lại.

## Cấu trúc

```
token-weather/
├── .claude-plugin/plugin.json   manifest
├── hooks/
│   ├── hooks.json               khai báo module của mod
│   └── token-weather.mjs        toàn bộ logic
├── types/index.d.ts             kiểu của state token-weather.readings
└── tests/token-weather.test.ts  test dải dự báo theo context
```
