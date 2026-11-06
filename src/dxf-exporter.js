/**
 * DXFExporter
 * Xuất bản vẽ 2D sang định dạng chuẩn AutoCAD (.DXF)
 * Tương thích AutoCAD 2007 - 2025+, SolidWorks, LibreCAD
 */
export class DXFExporter {
  /**
   * Xuất một mặt phẳng vẽ 2D đơn lẻ sang DXF
   * @param {Object} planeData - { visibleLines, hiddenLines, planeName, bounds }
   * @param {String} filename
   */
  static downloadPlaneDXF(planeData, filename = 'ban_ve_2d.dxf') {
    const {
      visibleLines = [],
      hiddenLines = [],
      circles = [],
      arcs = [],
      planeName = 'MAT_DUNG',
      bounds = { w: 6, h: 4, d: 4 }
    } = planeData;
    const { w, h, d } = bounds;

    // Tỉ lệ scale trong AutoCAD: 1 đơn vị grid = 10mm
    const scale = 10;
    const originX = 50;
    const originY = 50;

    let out = [];

    // 1. HEADER SECTION
    out.push('0', 'SECTION', '2', 'HEADER');
    out.push('9', '$ACADVER', '1', 'AC1009'); // AutoCAD R12 standard
    out.push('9', '$INSUNITS', '70', '4');    // Millimeters
    out.push('0', 'ENDSEC');

    // 2. TABLES SECTION: LINETYPE & LAYERS
    out.push('0', 'SECTION', '2', 'TABLES');

    out.push('0', 'TABLE', '2', 'LTYPE', '70', '2');
    out.push('0', 'LTYPE', '2', 'CONTINUOUS', '70', '0', '3', 'Solid line', '72', '65', '73', '0', '40', '0.0');
    out.push('0', 'LTYPE', '2', 'HIDDEN', '70', '0', '3', 'Dashed __ __', '72', '65', '73', '2', '40', '9.0', '49', '6.0', '49', '-3.0');
    out.push('0', 'ENDTAB');

    out.push('0', 'TABLE', '2', 'LAYER', '70', '4');
    out.push('0', 'LAYER', '2', '0', '70', '0', '62', '7', '6', 'CONTINUOUS');
    out.push('0', 'LAYER', '2', 'NET_THAY', '70', '0', '62', '7', '6', 'CONTINUOUS');
    out.push('0', 'LAYER', '2', 'NET_KHUAT', '70', '0', '62', '1', '6', 'HIDDEN');
    out.push('0', 'LAYER', '2', 'KHUNG_TEN', '70', '0', '62', '3', '6', 'CONTINUOUS');
    out.push('0', 'ENDTAB');

    out.push('0', 'ENDSEC');

    // 3. ENTITIES SECTION
    out.push('0', 'SECTION', '2', 'ENTITIES');

    const addLine = (layer, x1, y1, x2, y2) => {
      out.push(
        '0', 'LINE',
        '8', layer,
        '10', x1.toFixed(3), '20', y1.toFixed(3), '30', '0.0',
        '11', x2.toFixed(3), '21', y2.toFixed(3), '31', '0.0'
      );
    };

    const addCircle = (layer, cx, cy, r) => {
      out.push(
        '0', 'CIRCLE',
        '8', layer,
        '10', cx.toFixed(3), '20', cy.toFixed(3), '30', '0.0',
        '40', r.toFixed(3)
      );
    };

    const addArc = (layer, cx, cy, r, startAngleDeg, endAngleDeg) => {
      out.push(
        '0', 'ARC',
        '8', layer,
        '10', cx.toFixed(3), '20', cy.toFixed(3), '30', '0.0',
        '40', r.toFixed(3),
        '50', startAngleDeg.toFixed(2),
        '51', endAngleDeg.toFixed(2)
      );
    };

    const addText = (layer, text, x, y, height = 3.5) => {
      out.push(
        '0', 'TEXT',
        '8', layer,
        '10', x.toFixed(3), '20', y.toFixed(3), '30', '0.0',
        '40', height.toFixed(2),
        '1', text
      );
    };

    // Tiêu đề mặt vẽ
    addText('KHUNG_TEN', `BAN VE 2D: ${planeName.toUpperCase()}`, originX, originY + (h + 1) * scale + 6, 4.5);

    // Vẽ nét thấy (đoạn thẳng)
    for (const line of visibleLines) {
      addLine('NET_THAY', originX + line.p1.u * scale, originY + line.p1.v * scale, originX + line.p2.u * scale, originY + line.p2.v * scale);
    }

    // Vẽ nét khuất (đoạn thẳng)
    for (const line of hiddenLines) {
      addLine('NET_KHUAT', originX + line.p1.u * scale, originY + line.p1.v * scale, originX + line.p2.u * scale, originY + line.p2.v * scale);
    }

    // Vẽ đường tròn
    for (const c of circles) {
      const layer = (c.style === 'hidden') ? 'NET_KHUAT' : 'NET_THAY';
      addCircle(layer, originX + c.cx * scale, originY + c.cy * scale, c.r * scale);
    }

    // Vẽ cung cong (AutoCAD Arc góc CCW tính bằng độ)
    for (const a of arcs) {
      const layer = (a.style === 'hidden') ? 'NET_KHUAT' : 'NET_THAY';
      let deg1 = (a.startAngle * 180 / Math.PI) % 360;
      if (deg1 < 0) deg1 += 360;
      let deg2 = (a.endAngle * 180 / Math.PI) % 360;
      if (deg2 < 0) deg2 += 360;
      addArc(layer, originX + a.cx * scale, originY + a.cy * scale, a.r * scale, deg1, deg2);
    }

    // Khung A4 tiêu chuẩn (297 x 210 mm)
    const paperW = 297, paperH = 210;
    addLine('KHUNG_TEN', 0, 0, paperW, 0);
    addLine('KHUNG_TEN', paperW, 0, paperW, paperH);
    addLine('KHUNG_TEN', paperW, paperH, 0, paperH);
    addLine('KHUNG_TEN', 0, paperH, 0, 0);

    // Khung trong (lề trái 20mm, các lề khác 5mm)
    const marginL = 20, marginR = 292, marginB = 5, marginT = 205;
    addLine('KHUNG_TEN', marginL, marginB, marginR, marginB);
    addLine('KHUNG_TEN', marginR, marginB, marginR, marginT);
    addLine('KHUNG_TEN', marginR, marginT, marginL, marginT);
    addLine('KHUNG_TEN', marginL, marginT, marginL, marginB);

    // Khung tên tiêu chuẩn góc dưới bên phải
    const tbW = 140, tbH = 30;
    const tbX = marginR - tbW, tbY = marginB;
    addLine('KHUNG_TEN', tbX, tbY, tbX, tbY + tbH);
    addLine('KHUNG_TEN', tbX, tbY + tbH, marginR, tbY + tbH);
    addLine('KHUNG_TEN', tbX, tbY + 15, marginR, tbY + 15);
    addText('KHUNG_TEN', '3D BLOCK CAD - BAN VE 2D MAT PHANG', tbX + 5, tbY + 18, 4.0);
    addText('KHUNG_TEN', `MAT VE: ${planeName.toUpperCase()} | TY LE 1:1`, tbX + 5, tbY + 5, 3.0);

    out.push('0', 'ENDSEC');
    out.push('0', 'EOF');

    const dxfString = out.join('\r\n');
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
