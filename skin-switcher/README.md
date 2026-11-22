# Skin Switcher

Mod cho Claude Code chỉ làm một việc: đổi skin. Gõ `/skin`, một danh sách hiện ra, chọn một skin thì màu của Claude đổi ngay.

Các skin lấy từ repo [hellosverre/claude-skins](https://github.com/hellosverre/claude-skins) (giấy phép MIT, xem `hooks/themes/LICENSE`).

## Cách dùng

| Gõ | Kết quả |
| :- | :- |
| `/skin` | Mở pane **Skin** với danh sách để chọn |
| `/skin nord` | Đổi thẳng sang skin `nord`, không cần mở danh sách |
| `/skin default` | Như chọn **Default** trong danh sách |

**Default (Claude)** là lựa chọn đầu tiên. Khi chưa bật skin nào, chọn Default không làm gì cả. Khi đang bật một skin, chọn Default sẽ gỡ skin đó và trả Claude về giao diện gốc.

Skin đã chọn được lưu lại, phiên sau tự bật lại skin đó.

Khi gõ `/skin`, dòng gợi ý mờ sau tên lệnh cho biết skin đang dùng và mọi tên có thể gõ, ví dụ:

```
/skin now: Nord · default | noir | tokyo-night | dracula | nord | …
```

Gợi ý này cập nhật ngay sau mỗi lần đổi skin.

## Danh sách skin

| Tên gõ | Tên hiển thị | Chế độ |
| :- | :- | :- |
| `noir` | Noir | sáng + tối |
| `tokyo-night` | Tokyo Night | sáng + tối |
| `dracula` | Dracula | chỉ tối |
| `nord` | Nord | chỉ tối |
| `gruvbox` | Gruvbox | chỉ tối |
| `catppuccin` | Catppuccin Mocha | sáng + tối |
| `rose-pine` | Rosé Pine | sáng + tối |
| `everforest` | Everforest | sáng + tối |
| `one-dark` | One Dark | sáng + tối |
| `solarized` | Solarized | sáng + tối |
| `github` | GitHub | sáng + tối |
| `kanagawa` | Kanagawa | sáng + tối |
| `ayu` | Ayu | sáng + tối |
| `night-owl` | Night Owl | chỉ tối |
| `mono` | Monochrome | chỉ tối |

Skin "chỉ tối" là skin mà repo gốc không có bảng màu sáng, nên khi bật, app sẽ hiển thị ở chế độ tối.

Skin `terminal` của repo gốc không có trong danh sách: nó chỉ trỏ tới màu ANSI của terminal, thứ mà theme của app không dùng được.

## Giới hạn

- **Màu chỉ hiện trong app desktop và mobile.** Theme của Claude Code (`$.theme.set`) không vẽ trong terminal hay VS Code. Ở đó lệnh vẫn chạy và lưu lựa chọn, và sẽ báo rằng màu không được vẽ ở đây.
- **Chỉ đổi bảng màu.** Repo gốc còn vẽ lại các dòng tool, khối code, bảng, biểu đồ, câu chữ của spinner... Mod này không làm những thứ đó.
- **Màu có thể khác bản gốc một chút.** App desktop từ chối vẽ theme có chữ quá mờ so với nền. Với các skin bị từ chối, mod tự làm chữ sáng hơn (ở chế độ tối thì nền cũng tối hơn một chút) chỉ đến mức vừa đủ để app chịu vẽ. Noir và GitHub giữ nguyên màu gốc.

## Cấu trúc

```
skin-switcher/
├── .claude-plugin/plugin.json      manifest
├── hooks/
│   ├── hooks.json                  khai báo module của mod
│   ├── register.tsx                lệnh /skin, pane chọn skin, lưu lựa chọn
│   ├── look.ts                     đổi bảng màu của skin thành màu theme của app
│   ├── skin.ts                     kiểu dữ liệu của một skin
│   ├── make-colors.js / .d.ts      công cụ tạo theme của Claude Code (chép nguyên)
│   └── themes/                     các skin, chép từ hellosverre/claude-skins
└── tests/skin-switcher.test.tsx    test danh sách, chọn skin, Default
```

## Cài đặt

Chạy từ thư mục chứa `my-mods/`:

```bash
claude plugin marketplace add ./my-mods
claude plugin install skin-switcher@my-mods
```

Sau khi sửa code, chạy `/reload-plugins` trong phiên để nạp lại.
