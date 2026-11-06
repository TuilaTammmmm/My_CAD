/**
 * DXFExporter
 * Xuất bản vẽ 2D (3 hình chiếu vuông góc) sang định dạng chuẩn AutoCAD (.DXF)
 * Tương thích AutoCAD 2007 - 2025+, SolidWorks, LibreCAD
 */
export class DXFExporter {
  /**
   * Tạo chuỗi định dạng ASCII DXF R12 tiêu chuẩn
   */
  static generateDXF(drawingData, options = {}) {
    const { front, top, side, bounds, customLines = [] } = drawingData;
    const { w, h, d } = bounds;

    // Tỉ lệ scale trong AutoCAD (ví dụ 1 đơn vị grid = 10mm thực tế)
    const scale = options.scale || 10;
    const spacing = options.spacing || 30; // Khoảng cách giữa các hình chiếu (mm)

    // Tọa độ đặt 3 hình chiếu trên bản vẽ (mm):
    // - Hình chiếu Bằng: đặt ở dưới góc trái (X0, Y0)
    // - Hình chiếu Đứng: đặt ngay phía trên hình chiếu bằng (X0, Y0 + d * scale + spacing)
    // - Hình chiếu Cạnh: đặt ngay bên phải hình chiếu đứng (X0 + w * scale + spacing, Y0 + d * scale + spacing)
    const originX = 50;
    const originY = 50;

    const topOrigin = { x: originX, y: originY };
    const frontOrigin = { x: originX, y: originY + d * scale + spacing };
    const sideOrigin = { x: originX + w * scale + spacing, y: originY + d * scale + spacing };

    let out = [];

    // 1. HEADER SECTION
    out.push('0', 'SECTION', '2', 'HEADER');
    out.push('9', '$ACADVER', '1', 'AC1009'); // AutoCAD R12 standard
    out.push('9', '$INSUNITS', '70', '4');    // Millimeters
    out.push('0', 'ENDSEC');

    // 2. TABLES SECTION: LINETYPE & LAYERS
    out.push('0', 'SECTION', '2', 'TABLES');

    // Linetype table
    out.push('0', 'TABLE', '2', 'LTYPE', '70', '2');
    out.push('0', 'LTYPE', '2', 'CONTINUOUS', '70', '0', '3', 'Solid line', '72', '65', '73', '0', '40', '0.0');
    out.push('0', 'LTYPE', '2', 'HIDDEN', '70', '0', '3', 'Dashed __ __', '72', '65', '73', '2', '40', '9.0', '49', '6.0', '49', '-3.0');
    out.push('0', 'ENDTAB');

    // Layer table
    out.push('0', 'TABLE', '2', 'LAYER', '70', '5');
    // Layer 0
    out.push('0', 'LAYER', '2', '0', '70', '0', '62', '7', '6', 'CONTINUOUS');
    // Layer NET_THAY (Trắng/Cyan, Nét đậm 0.5mm)
    out.push('0', 'LAYER', '2', 'NET_THAY', '70', '0', '62', '7', '6', 'CONTINUOUS');
    // Layer NET_KHUAT (Đỏ/Vàng, Nét đứt HIDDEN 0.25mm)
    out.push('0', 'LAYER', '2', 'NET_KHUAT', '70', '0', '62', '1', '6', 'HIDDEN');
    // Layer DUONG_DONG (Xám, Nét dóng mảnh 0.15mm)
    out.push('0', 'LAYER', '2', 'DUONG_DONG', '70', '0', '62', '8', '6', 'CONTINUOUS');
    // Layer KHUNG_TEN (Xanh lá, Khung bản vẽ)
    out.push('0', 'LAYER', '2', 'KHUNG_TEN', '70', '0', '62', '3', '6', 'CONTINUOUS');
    out.push('0', 'ENDTAB');

    out.push('0', 'ENDSEC');

    // 3. ENTITIES SECTION: CÁC ĐOẠN THẲNG & VĂN BẢN
    out.push('0', 'SECTION', '2', 'ENTITIES');

    // Hàm thêm 1 đoạn thẳng LINE vào file DXF
    const addLine = (layer, x1, y1, x2, y2) => {
      out.push(
        '0', 'LINE',
        '8', layer,
        '10', x1.toFixed(3), '20', y1.toFixed(3), '30', '0.0',
        '11', x2.toFixed(3), '21', y2.toFixed(3), '31', '0.0'
      );
    };

    // Hàm thêm chữ TEXT vào file DXF
    const addText = (layer, text, x, y, height = 3.5) => {
      out.push(
        '0', 'TEXT',
        '8', layer,
        '10', x.toFixed(3), '20', y.toFixed(3), '30', '0.0',
        '40', height.toFixed(2),
        '1', text
      );
    };

    // --- HÌNH CHIẾU ĐỨNG (FRONT VIEW) ---
    addText('KHUNG_TEN', 'HINH CHIEU DUNG', frontOrigin.x, frontOrigin.y + h * scale + 5, 4.0);
    for (const line of front.visible) {
      addLine('NET_THAY', frontOrigin.x + line.p1.u * scale, frontOrigin.y + line.p1.v * scale, frontOrigin.x + line.p2.u * scale, frontOrigin.y + line.p2.v * scale);
    }
    for (const line of front.hidden) {
      addLine('NET_KHUAT', frontOrigin.x + line.p1.u * scale, frontOrigin.y + line.p1.v * scale, frontOrigin.x + line.p2.u * scale, frontOrigin.y + line.p2.v * scale);
    }

    // --- HÌNH CHIẾU BẰNG (TOP VIEW) ---
    addText('KHUNG_TEN', 'HINH CHIEU BANG', topOrigin.x, topOrigin.y - 8, 4.0);
    for (const line of top.visible) {
      addLine('NET_THAY', topOrigin.x + line.p1.u * scale, topOrigin.y + line.p1.v * scale, topOrigin.x + line.p2.u * scale, topOrigin.y + line.p2.v * scale);
    }
    for (const line of top.hidden) {
      addLine('NET_KHUAT', topOrigin.x + line.p1.u * scale, topOrigin.y + line.p1.v * scale, topOrigin.x + line.p2.u * scale, topOrigin.y + line.p2.v * scale);
    }

    // --- HÌNH CHIẾU CẠNH (SIDE VIEW) ---
    addText('KHUNG_TEN', 'HINH CHIEU CANH', sideOrigin.x, sideOrigin.y + h * scale + 5, 4.0);
    for (const line of side.visible) {
      addLine('NET_THAY', sideOrigin.x + line.p1.u * scale, sideOrigin.y + line.p1.v * scale, sideOrigin.x + line.p2.u * scale, sideOrigin.y + line.p2.v * scale);
    }
    for (const line of side.hidden) {
      addLine('NET_KHUAT', sideOrigin.x + line.p1.u * scale, sideOrigin.y + line.p1.v * scale, sideOrigin.x + line.p2.u * scale, sideOrigin.y + line.p2.v * scale);
    }

    // --- ĐƯỜNG DÓNG LIÊN HỆ KỸ THUẬT (PROJECTION RAYS) ---
    // Đường dóng dọc giữa Hình chiếu đứng và Hình chiếu bằng
    addLine('DUONG_DONG', frontOrigin.x, frontOrigin.y, topOrigin.x, topOrigin.y + d * scale);
    addLine('DUONG_DONG', frontOrigin.x + w * scale, frontOrigin.y, topOrigin.x + w * scale, topOrigin.y + d * scale);

    // Đường dóng ngang giữa Hình chiếu đứng và Hình chiếu cạnh
    addLine('DUONG_DONG', frontOrigin.x + w * scale, frontOrigin.y, sideOrigin.x, sideOrigin.y);
    addLine('DUONG_DONG', frontOrigin.x + w * scale, frontOrigin.y + h * scale, sideOrigin.x, sideOrigin.y + h * scale);

    // Đường dóng góc 45 độ đối chiếu Chiếu bằng sang Chiếu cạnh
    const cornerX = originX + w * scale + spacing;
    const cornerY = originY + d * scale;
    addLine('DUONG_DONG', cornerX, cornerY, cornerX + d * scale, cornerY - d * scale);

    // --- KHUNG BẢN VẼ TIÊU CHUẨN A4 (297 x 210 mm) ---
    const paperW = 297, paperH = 210;
    // Khung ngoài
    addLine('KHUNG_TEN', 0, 0, paperW, 0);
    addLine('KHUNG_TEN', paperW, 0, paperW, paperH);
    addLine('KHUNG_TEN', paperW, paperH, 0, paperH);
    addLine('KHUNG_TEN', 0, paperH, 0, 0);

    // Khung trong (lề trái 20mm, các lề khác 5mm theo TCVN)
    const marginL = 20, marginR = 292, marginB = 5, marginT = 205;
    addLine('KHUNG_TEN', marginL, marginB, marginR, marginB);
    addLine('KHUNG_TEN', marginR, marginB, marginR, marginT);
    addLine('KHUNG_TEN', marginR, marginT, marginL, marginT);
    addLine('KHUNG_TEN', marginL, marginT, marginL, marginB);

    // Khung tên tiêu chuẩn góc dưới bên phải (140 x 32 mm)
    const tbW = 140, tbH = 32;
    const tbX = marginR - tbW, tbY = marginB;
    addLine('KHUNG_TEN', tbX, tbY, tbX, tbY + tbH);
    addLine('KHUNG_TEN', tbX, tbY + tbH, marginR, tbY + tbH);
    addLine('KHUNG_TEN', tbX, tbY + 16, marginR, tbY + 16);
    addText('KHUNG_TEN', '3D BLOCK CAD - BAN VE KY THUAT', tbX + 5, tbY + 20, 4.0);
    addText('KHUNG_TEN', `KICH THUOC KHOI: ${w}0 x ${h}0 x ${d}0 mm | TY LE 1:1`, tbX + 5, tbY + 6, 3.0);

    // --- CÁC NÉT VẼ TỰ CHỈNH THÊM CỦA NGƯỜI DÙNG (NẾU CÓ) ---
    if (customLines && customLines.length > 0) {
      for (const cl of customLines) {
        let baseOrigin = (cl.view === 'front') ? frontOrigin : (cl.view === 'top') ? topOrigin : sideOrigin;
        const layer = (cl.type === 'hidden') ? 'NET_KHUAT' : 'NET_THAY';
        addLine(layer, baseOrigin.x + cl.p1.u * scale, baseOrigin.y + cl.p1.v * scale, baseOrigin.x + cl.p2.u * scale, baseOrigin.y + cl.p2.v * scale);
      }
    }

    out.push('0', 'ENDSEC');
    out.push('0', 'EOF');

    return out.join('\r\n');
  }

  /**
   * Kích hoạt tải về file DXF
   */
  static downloadDXF(drawingData, filename = 'ban_ve_ky_thuat_2d.dxf') {
    const dxfString = this.generateDXF(drawingData);
    const blob = new Blob([dxfString], { type: 'application/dxf;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
}
