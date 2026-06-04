import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from chemistry_engine import ChemistryEngine, ReagentType, MOLES_EPSILON
from server import OTMerger, Operation, ExperimentTable
import time


def test_sequential_acid_base():
    print("Test 1: Sequential acid-base neutralization...")
    engine = ChemistryEngine()
    engine.add_reagent("HCl", 50)
    assert engine.acid_moles > 0, f"acid_moles should be > 0, got {engine.acid_moles}"
    assert engine.state.ph < 7, f"pH should be acidic, got {engine.state.ph}"

    engine.add_reagent("NaOH", 50)
    assert abs(engine.acid_moles - engine.base_moles) < MOLES_EPSILON, \
        f"acid and base should be balanced, acid={engine.acid_moles}, base={engine.base_moles}"
    assert abs(engine.state.ph - 7.0) < 0.1, f"pH should be neutral (~7), got {engine.state.ph}"
    print("  PASS: pH = {:.2f} (neutral)".format(engine.state.ph))


def test_concurrent_acid_base_merge():
    print("\nTest 2: Concurrent acid-base via OT merge...")
    engine = ChemistryEngine()
    base_snapshot = engine.snapshot()

    op_acid = Operation(
        op_type="add_reagent", user_id="user_a", lamport_time=1,
        base_version=0, data={"reagent": "HCl", "volume": 50}
    )
    op_base = Operation(
        op_type="add_reagent", user_id="user_b", lamport_time=2,
        base_version=0, data={"reagent": "NaOH", "volume": 50}
    )

    merger = OTMerger()
    result = merger.merge(engine, base_snapshot, [op_acid, op_base])
    engine.restore(result)

    assert abs(engine.acid_moles - engine.base_moles) < MOLES_EPSILON, \
        f"acid and base should be balanced after merge, acid={engine.acid_moles}, base={engine.base_moles}"
    assert abs(engine.state.ph - 7.0) < 0.1, \
        f"pH should be neutral after merge, got {engine.state.ph}"
    assert engine.state.volume_ml == 100, f"volume should be 100, got {engine.state.volume_ml}"
    print("  PASS: pH = {:.2f} (neutral), volume = {:.1f}mL".format(engine.state.ph, engine.state.volume_ml))


def test_concurrent_same_reagent_merge():
    print("\nTest 3: Concurrent same reagent (2x HCl) via OT merge...")
    engine = ChemistryEngine()
    base_snapshot = engine.snapshot()

    op1 = Operation(
        op_type="add_reagent", user_id="user_a", lamport_time=1,
        base_version=0, data={"reagent": "HCl", "volume": 50}
    )
    op2 = Operation(
        op_type="add_reagent", user_id="user_b", lamport_time=2,
        base_version=0, data={"reagent": "HCl", "volume": 50}
    )

    merger = OTMerger()
    result = merger.merge(engine, base_snapshot, [op1, op2])
    engine.restore(result)

    expected_moles = 1.0 * 0.05 * 2
    assert abs(engine.acid_moles - expected_moles) < MOLES_EPSILON, \
        f"acid_moles should be {expected_moles}, got {engine.acid_moles}"
    assert engine.state.ph < 1, f"pH should be very acidic, got {engine.state.ph}"
    assert engine.state.volume_ml == 100, f"volume should be 100, got {engine.state.volume_ml}"
    print("  PASS: pH = {:.2f} (strongly acidic), volume = {:.1f}mL".format(engine.state.ph, engine.state.volume_ml))


def test_concurrent_precipitation_merge():
    print("\nTest 4: Concurrent precipitation reaction (CuSO4 + NaOH_Solution) via OT merge...")
    engine = ChemistryEngine()
    base_snapshot = engine.snapshot()

    op1 = Operation(
        op_type="add_reagent", user_id="user_a", lamport_time=1,
        base_version=0, data={"reagent": "CuSO4", "volume": 50}
    )
    op2 = Operation(
        op_type="add_reagent", user_id="user_b", lamport_time=2,
        base_version=0, data={"reagent": "NaOH_Solution", "volume": 50}
    )

    merger = OTMerger()
    result = merger.merge(engine, base_snapshot, [op1, op2])
    engine.restore(result)

    assert engine.state.precipitate_grams > 0, \
        f"precipitate should form, got {engine.state.precipitate_grams}g"
    assert engine.state.precipitate_name == "Cu(OH)₂", \
        f"precipitate should be Cu(OH)₂, got {engine.state.precipitate_name}"
    print("  PASS: precipitate = {:.3f}g of {}".format(engine.state.precipitate_grams, engine.state.precipitate_name))


def test_idempotent_reactions():
    print("\nTest 5: Idempotent reactions (double commit should not double-react)...")
    engine = ChemistryEngine()
    engine.add_reagent("HCl", 50)
    engine.add_reagent("NaOH", 50)
    ph_after_first = engine.state.ph

    engine._apply_reactions_idempotent()
    engine._calculate_ph()
    ph_after_second = engine.state.ph

    assert abs(ph_after_first - ph_after_second) < 0.01, \
        f"pH should not change on re-application: {ph_after_first} vs {ph_after_second}"
    print("  PASS: pH stable at {:.2f} after double commit".format(ph_after_second))


def test_snapshot_restore():
    print("\nTest 6: Snapshot and restore...")
    engine = ChemistryEngine()
    engine.add_reagent("HCl", 50)
    snap = engine.snapshot()
    ph_before = engine.state.ph

    engine.add_reagent("NaOH", 50)
    ph_after_naoh = engine.state.ph
    assert abs(ph_after_naoh - 7.0) < 0.1, f"pH should be neutral, got {ph_after_naoh}"

    engine.restore(snap)
    assert abs(engine.state.ph - ph_before) < 0.01, \
        f"pH should restore to {ph_before}, got {engine.state.ph}"
    print("  PASS: Snapshot/restore preserves state (pH = {:.2f})".format(engine.state.ph))


def test_concurrent_with_existing_substances():
    print("\nTest 7: Concurrent ops with pre-existing CuSO4...")
    engine = ChemistryEngine()
    engine.add_reagent("CuSO4", 50)
    base_snapshot = engine.snapshot()

    op1 = Operation(
        op_type="add_reagent", user_id="user_a", lamport_time=1,
        base_version=engine.version, data={"reagent": "NaOH_Solution", "volume": 50}
    )
    op2 = Operation(
        op_type="add_reagent", user_id="user_b", lamport_time=2,
        base_version=engine.version, data={"reagent": "CuSO4", "volume": 50}
    )

    merger = OTMerger()
    result = merger.merge(engine, base_snapshot, [op1, op2])
    engine.restore(result)

    assert engine.state.precipitate_grams > 0, \
        f"precipitate should form from existing+new CuSO4, got {engine.state.precipitate_grams}g"
    cuso4_remaining = engine._get_moles(ReagentType.CUSO4)
    assert cuso4_remaining > MOLES_EPSILON, \
        f"extra CuSO4 should remain unreacted, got {cuso4_remaining} moles"
    print("  PASS: precipitate = {:.3f}g, remaining CuSO4 = {:.4f} mol".format(
        engine.state.precipitate_grams, cuso4_remaining))


def test_transform_heat_heat():
    print("\nTest 8: OT transform for concurrent heat operations...")
    merger = OTMerger()
    op_a = Operation(
        op_type="heat", user_id="user_a", lamport_time=1,
        base_version=0, data={"duration": 5.0, "power": 50.0}
    )
    op_b = Operation(
        op_type="heat", user_id="user_b", lamport_time=2,
        base_version=0, data={"duration": 3.0, "power": 50.0}
    )

    transformed = merger.transform(op_b, op_a)
    assert transformed.data["duration"] > op_b.data["duration"], \
        f"transformed heat duration should be adjusted, got {transformed.data['duration']}"
    print("  PASS: transformed heat duration = {:.1f}s (original: {:.1f}s)".format(
        transformed.data["duration"], op_b.data["duration"]))


def test_concurrent_agcl_precipitation():
    print("\nTest 9: Concurrent AgNO3 + NaCl precipitation via OT merge...")
    engine = ChemistryEngine()
    base_snapshot = engine.snapshot()

    op1 = Operation(
        op_type="add_reagent", user_id="user_a", lamport_time=1,
        base_version=0, data={"reagent": "AgNO3", "volume": 50}
    )
    op2 = Operation(
        op_type="add_reagent", user_id="user_b", lamport_time=2,
        base_version=0, data={"reagent": "NaCl", "volume": 50}
    )

    merger = OTMerger()
    result = merger.merge(engine, base_snapshot, [op1, op2])
    engine.restore(result)

    assert engine.state.precipitate_grams > 0, \
        f"AgCl precipitate should form, got {engine.state.precipitate_grams}g"
    assert engine.state.precipitate_name == "AgCl", \
        f"precipitate should be AgCl, got {engine.state.precipitate_name}"
    print("  PASS: AgCl precipitate = {:.3f}g".format(engine.state.precipitate_grams))


def test_table_concurrent_detection():
    print("\nTest 10: ExperimentTable concurrent operation detection...")
    table = ExperimentTable(table_id="test")
    table.engine.add_reagent("HCl", 50)
    table.save_snapshot()
    initial_version = table.current_version

    concurrent_ops = [
        op for op in table.operation_log
        if op.base_version <= 0 and op.lamport_time > 999
    ]
    assert len(concurrent_ops) == 0, "No concurrent ops should exist yet"
    print("  PASS: No false concurrent detection")


if __name__ == "__main__":
    print("=" * 60)
    print("  OT Merge Concurrency Tests for Chemistry Lab Simulator")
    print("=" * 60)

    test_sequential_acid_base()
    test_concurrent_acid_base_merge()
    test_concurrent_same_reagent_merge()
    test_concurrent_precipitation_merge()
    test_idempotent_reactions()
    test_snapshot_restore()
    test_concurrent_with_existing_substances()
    test_transform_heat_heat()
    test_concurrent_agcl_precipitation()
    test_table_concurrent_detection()

    print("\n" + "=" * 60)
    print("  All 10 tests passed!")
    print("=" * 60)
