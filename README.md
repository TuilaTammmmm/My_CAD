# 📐 3D Block CAD Builder (Mô Phỏng Hình Vẽ Kỹ Thuật 3D)

Dự án mô phỏng 3D trên nền Web chuyên dụng để giải các bài tập hình học họa hình, vẽ kỹ thuật, đục khoét khối hình hộp và cắt vát mặt chéo theo số ô lưới.

---

## 🚀 Cách Chạy Ứng Dụng

1. **Cách 1 (Nhanh nhất):** Nhấp đúp chuột vào file `start.bat` trong thư mục `C:\Tam\3d`. Trình duyệt sẽ tự động bật lên.
2. **Cách 2 (Dòng lệnh):**
   ```bash
   cd C:\Tam\3d
   npm run dev
   ```
   Sau đó mở liên kết hiển thị trên màn hình (`http://localhost:5173/`).

---

## 🎯 Chế Độ "Chỉ Xem" & "Chọn Góc Cắt"

1. **👁️ Chế độ Chỉ Xem (Mặc định khi mở):**
   * Khối 3D hiển thị sạch sẽ, **toàn bộ các nút lưới được ẩn đi** để bạn thoải mái quan sát hình, kiểm tra các góc chiếu kỹ thuật.
   * Kéo chuột trái tự do để xoay mô hình mà không sợ bị bấm nhầm điểm cắt.

2. **✂️ Các Chế độ Cắt (Vát Chéo, Vát Góc, Cắt Hộp, Rãnh V):**
   * Khi bạn bấm vào một nút công cụ cắt ở thanh trên cùng (hoặc sidebar), **các nút lưới ô trên bề mặt khối sẽ sáng lên**.
   * Rê chuột đến góc/nút lưới nào thì vòng tròn sáng Cyan sẽ bắt dính chính xác vào đó.
   * Click chọn điểm để tạo vùng cắt xem trước màu đỏ và bấm **✂️ CẮT NGAY** (hoặc `Enter`).
   * Sau khi cắt xong hoặc muốn quan sát lại, chỉ cần bấm nút **👁️ Chỉ Xem** thì toàn bộ nút lưới sẽ tự động ẩn đi.

---

## 🛠️ Các Kiểu Cắt Gọt Kỹ Thuật

| Chế độ / Tính năng | Thao tác trên hình 3D | Ứng với bài tập kỹ thuật |
| :--- | :--- | :--- |
| **👁️ Chỉ Xem** | Kéo chuột xoay mô hình, ẩn sạch các chấm nút lưới và đường grid. | Quan sát hình học, đối chiếu hình chiếu. |
| **🔄 Chiếu Ngang (90°)** | Click nút để xoay tuần tự 90°: Chiếu Đứng ➔ Cạnh Phải ➔ Sau ➔ Cạnh Trái. | So sánh bản vẽ hình chiếu kỹ thuật. |
| **📐 Vát Chéo (2 Điểm)** | Click **Góc 1** ➔ Click **Góc 2**. Dao cắt gọt phẳng nửa không gian. Bấm `[🔄 Đổi bên vát]` hoặc phím `Tab`/`F`. | Mặt nghiêng dốc, bậc thang chéo. |
| **🔺 Vát Góc (3 Điểm)** | Click **3 điểm** bất kỳ trên các cạnh kề đỉnh ➔ Bấm `[🔄 Đổi góc]` hoặc `Enter` để vát khối tứ diện. | Vát góc tam giác ở các góc hộp kỹ thuật. |
| **📦 Cắt Hộp (2 Góc)** | Click 2 góc đối diện trên hình ➔ Bấm **Khoét hộp** (có tùy chỉnh độ sâu trực tiếp). | Đục rãnh, khoét hốc hộp vuông góc. |
| **🔻 Rãnh V (3 Điểm)** | Click 3 điểm: Đỉnh rãnh và 2 chân rãnh ➔ Tự động tính toán chuẩn xác. | Đục rãnh chữ V xuyên suốt hoặc có cữ sâu. |
| **📁 Nhập OBJ / 💾 Xuất OBJ** | Nhập mô hình có sẵn để cắt tiếp hoặc xuất file 3D tiêu chuẩn `.obj`. | Tái sử dụng và tích hợp phần mềm CAD. |

---

## 🌐 Triển Khai Lên Vercel (Deploy to Vercel)

Dự án được cấu hình sẵn theo chuẩn Vite + Single Page Application, sẵn sàng deploy lên Vercel trong 1 click:
1. Đẩy code lên GitHub:
   ```bash
   git init
   git add .
   git commit -m "feat: 3D Block CAD Builder"
   git branch -M main
   git remote add origin https://github.com/<tai-khoan-cua-ban>/<ten-repo>.git
   git push -u origin main
   ```
2. Truy cập [vercel.com](https://vercel.com) ➔ Chọn **Add New Project** ➔ Chọn repo vừa tạo.
3. Vercel sẽ tự động nhận diện:
   * **Framework Preset:** Vite
   * **Build Command:** `npm run build`
   * **Output Directory:** `dist`
4. Bấm **Deploy** là trang web sẽ online ngay lập tức!

---

## ⌨️ Phím Tắt Tiện Lợi

| Phím | Chức năng |
| :--- | :--- |
| **Enter** hoặc **Space** | Thực hiện Cắt ngay lập tức |
| **Esc** | Hủy chọn điểm hiện tại / Xóa vùng xem trước |
| **Tab** hoặc **F** | Đổi hướng cắt vát (Cắt Bên A ⇋ Cắt Bên B) |
| **Ctrl + Z** | Hoàn tác (Undo) lại bước cắt trước |
| **Ctrl + Y** hoặc **Ctrl + Shift + Z** | Làm lại (Redo) |
| **Cuộn chuột** | Phóng to / Thu nhỏ |
| **Kéo chuột trái** | Xoay không gian 3D |
| **Shift + Kéo chuột phải** | Di chuyển góc nhìn (Pan) |
