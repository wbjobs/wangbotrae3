import pandas as pd
from typing import Dict, List, Tuple
from sqlalchemy.orm import Session
from .models import Part, Supplier, CarbonCalculation, BOM


class CarbonCalculator:
    def __init__(self, db: Session):
        self.db = db

    def calculate_part_carbon(self, part: Part) -> Tuple[float, float, float, float]:
        raw_material_carbon = 0.0
        production_carbon = 0.0
        transport_carbon = 0.0
        children_carbon = 0.0

        if part.supplier:
            supplier = part.supplier
            raw_material_carbon = supplier.material_raw_carbon * part.quantity
            production_carbon = supplier.production_carbon * part.quantity
            transport_carbon = supplier.transport_carbon_per_km * supplier.transport_distance * part.quantity

        for child in part.children:
            child_raw, child_prod, child_trans, child_children = self.calculate_part_carbon(child)
            children_carbon += child_raw + child_prod + child_trans + child_children

        return raw_material_carbon, production_carbon, transport_carbon, children_carbon

    def calculate_bom_carbon(self, bom_id: int) -> Dict:
        bom = self.db.query(BOM).filter(BOM.id == bom_id).first()
        if not bom:
            raise ValueError(f"BOM with id {bom_id} not found")

        self.db.query(CarbonCalculation).filter(CarbonCalculation.bom_id == bom_id).delete()

        root_parts = self.db.query(Part).filter(
            Part.bom_id == bom_id,
            Part.parent_id.is_(None)
        ).all()

        total_raw = 0.0
        total_production = 0.0
        total_transport = 0.0
        total_children = 0.0

        for part in bom.parts:
            raw, prod, trans, children = self.calculate_part_carbon(part)

            calc = CarbonCalculation(
                bom_id=bom_id,
                part_id=part.id,
                raw_material_carbon=raw,
                production_carbon=prod,
                transport_carbon=trans,
                children_carbon=children,
                total_carbon=raw + prod + trans + children
            )
            self.db.add(calc)

            if part.parent_id is None:
                total_raw += raw
                total_production += prod
                total_transport += trans
                total_children += children

        bom.total_carbon = total_raw + total_production + total_transport + total_children
        self.db.commit()

        return {
            "bom_id": bom_id,
            "total_carbon": bom.total_carbon,
            "raw_material_total": total_raw,
            "production_total": total_production,
            "transport_total": total_transport
        }

    def build_sankey_data(self, bom_id: int) -> Dict:
        bom = self.db.query(BOM).filter(BOM.id == bom_id).first()
        if not bom:
            raise ValueError(f"BOM with id {bom_id} not found")

        nodes = []
        links = []
        node_names = set()

        def add_part_to_sankey(part: Part, parent_name: str = None):
            part_name = f"{part.part_name}\n({part.part_number})"
            if part_name not in node_names:
                nodes.append({"name": part_name})
                node_names.add(part_name)

            calc = self.db.query(CarbonCalculation).filter(
                CarbonCalculation.part_id == part.id
            ).first()

            if calc and parent_name:
                links.append({
                    "source": part_name,
                    "target": parent_name,
                    "value": round(calc.total_carbon, 2)
                })

            for child in part.children:
                add_part_to_sankey(child, part_name)

        root_parts = self.db.query(Part).filter(
            Part.bom_id == bom_id,
            Part.parent_id.is_(None)
        ).all()

        product_node = f"成品: {bom.product_name}"
        nodes.append({"name": product_node})
        node_names.add(product_node)

        for root_part in root_parts:
            add_part_to_sankey(root_part, product_node)

        return {
            "nodes": nodes,
            "links": links
        }

    def validate_bom(self, bom_id: int) -> Dict:
        bom = self.db.query(BOM).filter(BOM.id == bom_id).first()
        if not bom:
            return {"is_valid": False, "errors": ["BOM not found"], "warnings": []}

        errors = []
        warnings = []

        parts = self.db.query(Part).filter(Part.bom_id == bom_id).all()
        part_numbers = {p.part_number for p in parts}

        for part in parts:
            if part.parent_id:
                parent = self.db.query(Part).filter(Part.id == part.parent_id).first()
                if not parent:
                    errors.append(f"Part {part.part_number}: Parent not found")

            if part.supplier_id:
                supplier = self.db.query(Supplier).filter(Supplier.id == part.supplier_id).first()
                if not supplier:
                    warnings.append(f"Part {part.part_number}: Supplier data missing")
            else:
                warnings.append(f"Part {part.part_number}: No supplier assigned")

        if not errors:
            bom.is_validated = True
            self.db.commit()

        return {
            "is_valid": len(errors) == 0,
            "errors": errors,
            "warnings": warnings
        }

    def compare_boms(self, original_bom_id: int, modified_bom_id: int) -> Dict:
        original = self.db.query(BOM).filter(BOM.id == original_bom_id).first()
        modified = self.db.query(BOM).filter(BOM.id == modified_bom_id).first()

        if not original or not modified:
            raise ValueError("One or both BOMs not found")

        difference = modified.total_carbon - original.total_carbon
        percentage_change = (difference / original.total_carbon * 100) if original.total_carbon > 0 else 0

        return {
            "original_total": original.total_carbon,
            "modified_total": modified.total_carbon,
            "difference": difference,
            "percentage_change": percentage_change
        }


def import_bom_from_excel(file_path: str, db: Session) -> BOM:
    df = pd.read_excel(file_path)

    product_name = df.iloc[0].get('product_name', 'Imported Product')
    description = df.iloc[0].get('description', '')

    bom = BOM(product_name=product_name, description=description)
    db.add(bom)
    db.commit()
    db.refresh(bom)

    part_map = {}

    for _, row in df.iterrows():
        part_number = str(row.get('part_number', ''))
        if not part_number:
            continue

        part = Part(
            bom_id=bom.id,
            part_number=part_number,
            part_name=str(row.get('part_name', 'Unknown')),
            quantity=float(row.get('quantity', 1)),
            unit=str(row.get('unit', 'pcs')),
            level=int(row.get('level', 0)),
            material_type=str(row.get('material_type', '')) if pd.notna(row.get('material_type')) else None
        )

        supplier_code = row.get('supplier_code')
        if supplier_code and pd.notna(supplier_code):
            supplier = db.query(Supplier).filter(Supplier.code == str(supplier_code)).first()
            if supplier:
                part.supplier_id = supplier.id

        db.add(part)
        db.flush()
        part_map[part_number] = part

    for _, row in df.iterrows():
        part_number = str(row.get('part_number', ''))
        parent_part_number = row.get('parent_part_number')

        if part_number in part_map and parent_part_number and pd.notna(parent_part_number):
            parent_part_number = str(parent_part_number)
            if parent_part_number in part_map:
                part_map[part_number].parent_id = part_map[parent_part_number].id

    db.commit()
    return bom


def import_suppliers_from_excel(file_path: str, db: Session) -> List[Supplier]:
    df = pd.read_excel(file_path)
    suppliers = []

    for _, row in df.iterrows():
        code = str(row.get('code', ''))
        if not code:
            continue

        existing = db.query(Supplier).filter(Supplier.code == code).first()
        if existing:
            existing.name = str(row.get('name', existing.name))
            existing.location = str(row.get('location', existing.location)) if pd.notna(row.get('location')) else existing.location
            existing.material_raw_carbon = float(row.get('material_raw_carbon', existing.material_raw_carbon))
            existing.production_carbon = float(row.get('production_carbon', existing.production_carbon))
            existing.transport_carbon_per_km = float(row.get('transport_carbon_per_km', existing.transport_carbon_per_km))
            existing.transport_distance = float(row.get('transport_distance', existing.transport_distance))
            suppliers.append(existing)
        else:
            supplier = Supplier(
                code=code,
                name=str(row.get('name', 'Unknown')),
                location=str(row.get('location', '')) if pd.notna(row.get('location')) else None,
                material_raw_carbon=float(row.get('material_raw_carbon', 0)),
                production_carbon=float(row.get('production_carbon', 0)),
                transport_carbon_per_km=float(row.get('transport_carbon_per_km', 0)),
                transport_distance=float(row.get('transport_distance', 0))
            )
            db.add(supplier)
            suppliers.append(supplier)

    db.commit()
    return suppliers
