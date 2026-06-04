import os
from datetime import datetime
from io import BytesIO
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.lib.enums import TA_CENTER
from sqlalchemy.orm import Session
from .models import BOM, Part, CarbonCalculation, Supplier


def generate_pdf_report(bom_id: int, db: Session) -> bytes:
    bom = db.query(BOM).filter(BOM.id == bom_id).first()
    if not bom:
        raise ValueError(f"BOM with id {bom_id} not found")

    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=2*cm,
        leftMargin=2*cm,
        topMargin=2*cm,
        bottomMargin=2*cm
    )

    styles = getSampleStyleSheet()
    story = []

    title_style = ParagraphStyle(
        'CustomTitle',
        parent=styles['Heading1'],
        fontSize=24,
        spaceAfter=30,
        alignment=TA_CENTER,
        textColor=colors.HexColor('#2E7D32')
    )

    heading_style = ParagraphStyle(
        'CustomHeading',
        parent=styles['Heading2'],
        fontSize=16,
        spaceAfter=12,
        textColor=colors.HexColor('#1565C0')
    )

    story.append(Paragraph("产品碳足迹分析报告", title_style))
    story.append(Spacer(1, 20))

    story.append(Paragraph("一、产品信息", heading_style))
    info_data = [
        ["产品名称", bom.product_name],
        ["产品描述", bom.description or "-"],
        ["创建时间", bom.created_at.strftime("%Y-%m-%d %H:%M:%S")],
        ["总碳排放量", f"{bom.total_carbon:.2f} kg CO₂e"]
    ]
    info_table = Table(info_data, colWidths=[5*cm, 10*cm])
    info_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (0, -1), colors.HexColor('#E3F2FD')),
        ('TEXTCOLOR', (0, 0), (-1, -1), colors.black),
        ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
        ('FONTNAME', (0, 0), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 0), (-1, -1), 10),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
        ('GRID', (0, 0), (-1, -1), 1, colors.grey)
    ]))
    story.append(info_table)
    story.append(Spacer(1, 20))

    story.append(Paragraph("二、碳排放构成", heading_style))

    calc_summary = db.query(CarbonCalculation).join(Part).filter(
        CarbonCalculation.bom_id == bom_id,
        Part.parent_id.is_(None)
    ).all()

    raw_total = sum(c.raw_material_carbon for c in calc_summary)
    prod_total = sum(c.production_carbon for c in calc_summary)
    trans_total = sum(c.transport_carbon for c in calc_summary)
    children_total = sum(c.children_carbon for c in calc_summary)

    composition_data = [
        ["排放阶段", "碳排放量 (kg CO₂e)", "占比"]
    ]

    total = bom.total_carbon if bom.total_carbon > 0 else 1
    composition_data.extend([
        ["原材料获取", f"{raw_total:.2f}", f"{raw_total/total*100:.1f}%"],
        ["生产制造", f"{prod_total:.2f}", f"{prod_total/total*100:.1f}%"],
        ["运输配送", f"{trans_total:.2f}", f"{trans_total/total*100:.1f}%"],
        ["子部件汇总", f"{children_total:.2f}", f"{children_total/total*100:.1f}%"],
        ["总计", f"{bom.total_carbon:.2f}", "100%"]
    ])

    comp_table = Table(composition_data, colWidths=[5*cm, 5*cm, 5*cm])
    comp_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1565C0')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('FONTNAME', (0, 0), (-1, -1), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 11),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
        ('BACKGROUND', (0, 1), (-1, -1), colors.HexColor('#F5F5F5')),
        ('GRID', (0, 0), (-1, -1), 1, colors.grey),
        ('BACKGROUND', (0, -1), (-1, -1), colors.HexColor('#C8E6C9'))
    ]))
    story.append(comp_table)
    story.append(Spacer(1, 20))

    story.append(Paragraph("三、零部件详细数据", heading_style))

    parts_data = [
        ["零件编号", "零件名称", "原材料", "生产", "运输", "子部件", "总计"]
    ]

    for part in bom.parts:
        calc = db.query(CarbonCalculation).filter(
            CarbonCalculation.part_id == part.id
        ).first()
        if calc:
            parts_data.append([
                part.part_number,
                part.part_name,
                f"{calc.raw_material_carbon:.2f}",
                f"{calc.production_carbon:.2f}",
                f"{calc.transport_carbon:.2f}",
                f"{calc.children_carbon:.2f}",
                f"{calc.total_carbon:.2f}"
            ])

    parts_table = Table(parts_data, colWidths=[2.5*cm, 3*cm, 2*cm, 2*cm, 2*cm, 2*cm, 2*cm])
    parts_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1565C0')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('FONTNAME', (0, 0), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 0), (-1, 0), 9),
        ('FONTSIZE', (0, 1), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.grey)
    ]))
    story.append(parts_table)
    story.append(Spacer(1, 20))

    story.append(Paragraph("四、供应商信息", heading_style))

    suppliers = db.query(Supplier).join(Part).filter(Part.bom_id == bom_id).distinct().all()

    if suppliers:
        supplier_data = [
            ["供应商代码", "供应商名称", "地点", "原材料碳排放", "生产碳排放"]
        ]
        for s in suppliers:
            supplier_data.append([
                s.code,
                s.name,
                s.location or "-",
                f"{s.material_raw_carbon:.2f}",
                f"{s.production_carbon:.2f}"
            ])

        supp_table = Table(supplier_data, colWidths=[3*cm, 4*cm, 3*cm, 3*cm, 3*cm])
        supp_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#388E3C')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('FONTNAME', (0, 0), (-1, -1), 'Helvetica'),
            ('FONTSIZE', (0, 0), (-1, -1), 9),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.grey)
        ]))
        story.append(supp_table)

    footer_style = ParagraphStyle(
        'Footer',
        parent=styles['Normal'],
        fontSize=8,
        textColor=colors.grey,
        alignment=TA_CENTER,
        spaceBefore=30
    )
    story.append(Spacer(1, 30))
    story.append(Paragraph("报告生成时间: " + datetime.now().strftime("%Y-%m-%d %H:%M:%S"), footer_style))
    story.append(Paragraph("供应链碳排放分析系统", footer_style))

    doc.build(story)

    pdf_bytes = buffer.getvalue()
    buffer.close()
    return pdf_bytes
