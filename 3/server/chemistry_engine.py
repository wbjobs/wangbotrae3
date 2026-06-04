import copy
import numpy as np
from dataclasses import dataclass, field
from typing import List, Dict, Optional, Tuple, Any
from enum import Enum


class ReagentType(Enum):
    HCL = "HCl"
    NAOH = "NaOH"
    CUSO4 = "CuSO4"
    NAOH_SOLUTION = "NaOH_Solution"
    AGNO3 = "AgNO3"
    NACL = "NaCl"
    BACL2 = "BaCl2"
    NA2SO4 = "Na2SO4"
    H2SO4 = "H2SO4"
    CACO3 = "CaCO3"
    FECL3 = "FeCl3"
    KSCN = "KSCN"
    NABCO3 = "NaHCO3"
    HNO3 = "HNO3"
    LITMUS = "Litmus"
    PHENOLPHTHALEIN = "Phenolphthalein"


class UndoType(Enum):
    ADD_REAGENT = "add_reagent"
    REMOVE_REAGENT = "remove_reagent"
    HEAT = "heat"
    COOL = "cool"
    STIR = "stir"
    UNSTIR = "unstir"
    RESET = "reset"
    UNRESET = "unreset"
    REACTION_EFFECT = "reaction_effect"


@dataclass
class UndoToken:
    undo_type: UndoType
    data: Dict[str, Any] = field(default_factory=dict)
    sub_tokens: List["UndoToken"] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "undo_type": self.undo_type.value,
            "data": self.data,
            "sub_tokens": [st.to_dict() for st in self.sub_tokens],
        }

    @classmethod
    def from_dict(cls, d: dict) -> "UndoToken":
        return cls(
            undo_type=UndoType(d["undo_type"]),
            data=d.get("data", {}),
            sub_tokens=[cls.from_dict(st) for st in d.get("sub_tokens", [])],
        )


@dataclass
class Substance:
    reagent: ReagentType
    moles: float
    concentration: float

    @property
    def volume_ml(self) -> float:
        return (self.moles / self.concentration) * 1000 if self.concentration > 0 else 0


@dataclass
class SolutionState:
    substances: List[Substance] = field(default_factory=list)
    ph: float = 7.0
    temperature: float = 25.0
    color: Tuple[float, float, float] = (0.9, 0.95, 1.0)
    color_name: str = "无色"
    precipitate_grams: float = 0.0
    precipitate_color: Tuple[float, float, float] = (1.0, 1.0, 1.0)
    precipitate_name: str = ""
    volume_ml: float = 0.0
    is_boiling: bool = False
    gas_evolved: str = ""
    reactions_log: List[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "ph": round(self.ph, 2),
            "temperature": round(self.temperature, 1),
            "color": [round(c, 3) for c in self.color],
            "color_name": self.color_name,
            "precipitate_grams": round(self.precipitate_grams, 3),
            "precipitate_color": [round(c, 3) for c in self.precipitate_color],
            "precipitate_name": self.precipitate_name,
            "volume_ml": round(self.volume_ml, 1),
            "is_boiling": self.is_boiling,
            "gas_evolved": self.gas_evolved,
            "reactions_log": list(self.reactions_log),
        }

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, SolutionState):
            return False
        if abs(self.ph - other.ph) > 1e-6:
            return False
        if abs(self.temperature - other.temperature) > 1e-6:
            return False
        if abs(self.precipitate_grams - other.precipitate_grams) > 1e-6:
            return False
        if abs(self.volume_ml - other.volume_ml) > 1e-6:
            return False
        if self.color_name != other.color_name:
            return False
        if self.is_boiling != other.is_boiling:
            return False
        if len(self.substances) != len(other.substances):
            return False
        for s1, s2 in zip(self.substances, other.substances):
            if s1.reagent != s2.reagent or abs(s1.moles - s2.moles) > 1e-10:
                return False
        return True


REACTION_TEMPLATES = {
    "acid_base_neutralization": {
        "name": "酸碱中和反应",
        "equation": "HCl + NaOH → NaCl + H₂O",
        "description": "强酸与强碱反应生成盐和水，放出热量",
        "reagents": {ReagentType.HCL, ReagentType.NAOH},
    },
    "precipitation_cu_oh": {
        "name": "氢氧化铜沉淀反应",
        "equation": "CuSO₄ + 2NaOH → Cu(OH)₂↓ + Na₂SO₄",
        "description": "蓝色氢氧化铜沉淀生成",
        "reagents": {ReagentType.CUSO4, ReagentType.NAOH_SOLUTION},
    },
    "precipitation_agcl": {
        "name": "氯化银沉淀反应",
        "equation": "AgNO₃ + NaCl → AgCl↓ + NaNO₃",
        "description": "白色氯化银沉淀，不溶于稀硝酸",
        "reagents": {ReagentType.AGNO3, ReagentType.NACL},
    },
    "precipitation_baso4": {
        "name": "硫酸钡沉淀反应",
        "equation": "BaCl₂ + Na₂SO₄ → BaSO₄↓ + 2NaCl",
        "description": "白色硫酸钡沉淀，不溶于酸",
        "reagents": {ReagentType.BACL2, ReagentType.NA2SO4},
    },
    "acid_carbonate": {
        "name": "酸与碳酸盐反应",
        "equation": "CaCO₃ + 2HCl → CaCl₂ + H₂O + CO₂↑",
        "description": "碳酸盐与酸反应产生CO₂气体",
        "reagents": {ReagentType.CACO3, ReagentType.HCL},
    },
    "fecl3_kscn": {
        "name": "铁离子显色反应",
        "equation": "FeCl₃ + 3KSCN → Fe(SCN)₃ + 3KCl",
        "description": "血红色络合物生成，检验Fe³⁺的特征反应",
        "reagents": {ReagentType.FECL3, ReagentType.KSCN},
    },
    "bicarbonate_acid": {
        "name": "小苏打与酸反应",
        "equation": "NaHCO₃ + HCl → NaCl + H₂O + CO₂↑",
        "description": "产生大量气泡，CO₂气体释放",
        "reagents": {ReagentType.NABCO3, ReagentType.HCL},
    },
}

REAGENT_PROPERTIES = {
    ReagentType.HCL: {"name": "盐酸 HCl", "molar_mass": 36.5, "color": (0.95, 0.98, 1.0), "color_name": "无色", "concentration": 1.0, "is_acid": True, "is_base": False, "is_salt": False, "default_volume": 50},
    ReagentType.NAOH: {"name": "氢氧化钠 NaOH", "molar_mass": 40.0, "color": (0.95, 0.95, 1.0), "color_name": "无色", "concentration": 1.0, "is_acid": False, "is_base": True, "is_salt": False, "default_volume": 50},
    ReagentType.CUSO4: {"name": "硫酸铜 CuSO₄", "molar_mass": 159.6, "color": (0.1, 0.4, 0.9), "color_name": "蓝色", "concentration": 0.5, "is_acid": False, "is_base": False, "is_salt": True, "default_volume": 50},
    ReagentType.NAOH_SOLUTION: {"name": "NaOH溶液", "molar_mass": 40.0, "color": (0.95, 0.95, 1.0), "color_name": "无色", "concentration": 1.0, "is_acid": False, "is_base": True, "is_salt": False, "default_volume": 50},
    ReagentType.AGNO3: {"name": "硝酸银 AgNO₃", "molar_mass": 169.9, "color": (0.95, 0.95, 1.0), "color_name": "无色", "concentration": 0.5, "is_acid": False, "is_base": False, "is_salt": True, "default_volume": 50},
    ReagentType.NACL: {"name": "氯化钠 NaCl", "molar_mass": 58.4, "color": (0.95, 0.95, 1.0), "color_name": "无色", "concentration": 1.0, "is_acid": False, "is_base": False, "is_salt": True, "default_volume": 50},
    ReagentType.BACL2: {"name": "氯化钡 BaCl₂", "molar_mass": 208.2, "color": (0.95, 0.95, 1.0), "color_name": "无色", "concentration": 0.5, "is_acid": False, "is_base": False, "is_salt": True, "default_volume": 50},
    ReagentType.NA2SO4: {"name": "硫酸钠 Na₂SO₄", "molar_mass": 142.0, "color": (0.95, 0.95, 1.0), "color_name": "无色", "concentration": 0.5, "is_acid": False, "is_base": False, "is_salt": True, "default_volume": 50},
    ReagentType.H2SO4: {"name": "硫酸 H₂SO₄", "molar_mass": 98.0, "color": (0.95, 0.95, 1.0), "color_name": "无色", "concentration": 1.0, "is_acid": True, "is_base": False, "is_salt": False, "default_volume": 50},
    ReagentType.CACO3: {"name": "碳酸钙 CaCO₃", "molar_mass": 100.1, "color": (1.0, 1.0, 1.0), "color_name": "白色", "concentration": 0.5, "is_acid": False, "is_base": False, "is_salt": True, "default_volume": 30},
    ReagentType.FECL3: {"name": "氯化铁 FeCl₃", "molar_mass": 162.2, "color": (0.8, 0.55, 0.1), "color_name": "黄褐色", "concentration": 0.5, "is_acid": False, "is_base": False, "is_salt": True, "default_volume": 50},
    ReagentType.KSCN: {"name": "硫氰化钾 KSCN", "molar_mass": 97.2, "color": (0.95, 0.95, 1.0), "color_name": "无色", "concentration": 1.0, "is_acid": False, "is_base": False, "is_salt": True, "default_volume": 50},
    ReagentType.NABCO3: {"name": "碳酸氢钠 NaHCO₃", "molar_mass": 84.0, "color": (1.0, 1.0, 1.0), "color_name": "白色", "concentration": 1.0, "is_acid": False, "is_base": True, "is_salt": True, "default_volume": 50},
    ReagentType.HNO3: {"name": "硝酸 HNO₃", "molar_mass": 63.0, "color": (0.95, 0.98, 1.0), "color_name": "无色", "concentration": 1.0, "is_acid": True, "is_base": False, "is_salt": False, "default_volume": 50},
    ReagentType.LITMUS: {"name": "石蕊指示剂", "molar_mass": 330.0, "color": (0.6, 0.2, 0.8), "color_name": "紫色", "concentration": 0.01, "is_acid": False, "is_base": False, "is_salt": False, "default_volume": 10},
    ReagentType.PHENOLPHTHALEIN: {"name": "酚酞指示剂", "molar_mass": 318.0, "color": (0.95, 0.95, 1.0), "color_name": "无色", "concentration": 0.01, "is_acid": False, "is_base": False, "is_salt": False, "default_volume": 10},
}

MOLES_EPSILON = 1e-10


class ChemistryEngine:
    def __init__(self):
        self.state = SolutionState()
        self.acid_moles = 0.0
        self.base_moles = 0.0
        self._version = 0
        self._pending_reactions: List[str] = []
        self._reactions_used_dedup: set = set()
        self._original_colors: Dict[str, Tuple] = {}

    @property
    def version(self) -> int:
        return self._version

    def snapshot(self) -> dict:
        return {
            "state": copy.deepcopy(self.state),
            "acid_moles": self.acid_moles,
            "base_moles": self.base_moles,
            "version": self._version,
            "_reactions_used_dedup": set(self._reactions_used_dedup),
            "_original_colors": dict(self._original_colors),
        }

    def restore(self, snap: dict):
        self.state = copy.deepcopy(snap["state"])
        self.acid_moles = snap["acid_moles"]
        self.base_moles = snap["base_moles"]
        self._version = snap["version"]
        self._reactions_used_dedup = set(snap.get("_reactions_used_dedup", set()))
        self._original_colors = dict(snap.get("_original_colors", {}))

    def reset(self) -> UndoToken:
        pre_reset_snapshot = self.snapshot()
        self.state = SolutionState()
        self.acid_moles = 0.0
        self.base_moles = 0.0
        self._pending_reactions = []
        self._reactions_used_dedup = set()
        self._original_colors = {}
        self._version += 1
        return UndoToken(
            undo_type=UndoType.RESET,
            data={"snapshot": pre_reset_snapshot}
        )

    def _unreset(self, token: UndoToken):
        snap = token.data["snapshot"]
        self.restore(snap)
        self._version += 1

    def add_reagent(self, reagent_type: str, volume_ml: float = 50.0) -> UndoToken:
        try:
            rt = ReagentType(reagent_type)
        except ValueError:
            return UndoToken(undo_type=UndoType.ADD_REAGENT, data={"skipped": True})

        props = REAGENT_PROPERTIES[rt]
        moles = props["concentration"] * (volume_ml / 1000.0)

        temp_state_before = self.snapshot()
        self._add_substance_only(reagent_type, volume_ml)
        reaction_tokens = self.commit_effects()

        return UndoToken(
            undo_type=UndoType.ADD_REAGENT,
            data={
                "reagent": reagent_type,
                "volume_ml": volume_ml,
                "moles": moles,
                "state_before": temp_state_before,
            },
            sub_tokens=reaction_tokens
        )

    def _add_substance_only(self, reagent_type: str, volume_ml: float = 50.0):
        try:
            rt = ReagentType(reagent_type)
        except ValueError:
            return

        props = REAGENT_PROPERTIES[rt]
        moles = props["concentration"] * (volume_ml / 1000.0)

        substance = Substance(reagent=rt, moles=moles, concentration=props["concentration"])
        self.state.substances.append(substance)
        self.state.volume_ml += volume_ml

        if props["is_acid"]:
            self.acid_moles += moles
        if props["is_base"]:
            self.base_moles += moles

        reagent_set = {s.reagent for s in self.state.substances if s.moles > MOLES_EPSILON}
        for key, template in REACTION_TEMPLATES.items():
            required = template["reagents"]
            if required.issubset(reagent_set):
                self._pending_reactions.append(key)

    def remove_reagent(self, reagent_type: str, moles_to_remove: float, volume_ml: float) -> UndoToken:
        try:
            rt = ReagentType(reagent_type)
        except ValueError:
            return UndoToken(undo_type=UndoType.REMOVE_REAGENT, data={"skipped": True})

        props = REAGENT_PROPERTIES[rt]
        temp_state_before = self.snapshot()

        removed = 0.0
        remaining_to_remove = moles_to_remove
        for s in self.state.substances:
            if s.reagent == rt and remaining_to_remove > MOLES_EPSILON:
                take = min(s.moles, remaining_to_remove)
                s.moles -= take
                remaining_to_remove -= take
                removed += take

        self.state.substances = [s for s in self.state.substances if s.moles > MOLES_EPSILON]
        self.state.volume_ml = max(0, self.state.volume_ml - volume_ml)

        if props["is_acid"]:
            self.acid_moles = max(0, self.acid_moles - removed)
        if props["is_base"]:
            self.base_moles = max(0, self.base_moles - removed)

        state_after_remove = self.snapshot()
        self._calculate_ph()
        self._calculate_color()
        self._update_thermal_state()
        self._version += 1

        return UndoToken(
            undo_type=UndoType.REMOVE_REAGENT,
            data={
                "reagent": reagent_type,
                "moles_removed": removed,
                "volume_ml": volume_ml,
                "state_before": temp_state_before,
                "state_after_remove": state_after_remove,
            }
        )

    def heat(self, duration_s: float = 5.0, power_w: float = 50.0) -> UndoToken:
        temp_before = self.state.temperature
        volume_before = self.state.volume_ml
        boiling_before = self.state.is_boiling

        mass_kg = max(volume_before / 1000.0, 0.001)
        specific_heat = 4186.0
        delta_t = (power_w * duration_s) / (mass_kg * specific_heat)
        self.state.temperature += delta_t

        evap_volume = 0.0
        if self.state.temperature >= 100.0:
            self.state.is_boiling = True
            self.state.temperature = min(self.state.temperature, 120.0)
            evap_rate = 0.5 * (duration_s / 60.0)
            evap_volume = min(evap_rate * 1000, volume_before)
            self.state.volume_ml = max(0, volume_before - evap_volume)

        self._update_thermal_state()
        self._calculate_ph()
        self._version += 1

        return UndoToken(
            undo_type=UndoType.HEAT,
            data={
                "duration": duration_s,
                "power": power_w,
                "temp_before": temp_before,
                "temp_after": self.state.temperature,
                "volume_before": volume_before,
                "volume_after": self.state.volume_ml,
                "evaporated_volume": evap_volume,
                "boiling_before": boiling_before,
                "boiling_after": self.state.is_boiling,
            }
        )

    def cool(self, token: UndoToken):
        data = token.data
        self.state.temperature = data["temp_before"]
        self.state.volume_ml = data["volume_before"]
        self.state.is_boiling = data["boiling_before"]
        self._update_thermal_state()
        self._calculate_ph()
        self._version += 1

    def stir(self, duration_s: float = 3.0) -> UndoToken:
        precip_before = self.state.precipitate_grams
        temp_before = self.state.temperature
        color_before = tuple(self.state.color)
        color_name_before = self.state.color_name
        ph_before = self.state.ph

        self._calculate_ph()
        self._calculate_color()
        self._update_thermal_state()

        precip_dissolved = 0.0
        if self.state.precipitate_grams > 0 and self.state.temperature > 60:
            precip_dissolved = min(0.1 * duration_s, self.state.precipitate_grams * 0.05)
            self.state.precipitate_grams = max(0, self.state.precipitate_grams - precip_dissolved)

        self._version += 1

        return UndoToken(
            undo_type=UndoType.STIR,
            data={
                "duration": duration_s,
                "precip_before": precip_before,
                "precip_after": self.state.precipitate_grams,
                "precip_dissolved": precip_dissolved,
                "temp_before": temp_before,
                "color_before": list(color_before),
                "color_name_before": color_name_before,
                "ph_before": ph_before,
            }
        )

    def unstir(self, token: UndoToken):
        data = token.data
        self.state.precipitate_grams = data["precip_before"]
        self.state.color = tuple(data["color_before"])
        self.state.color_name = data["color_name_before"]
        self.state.ph = data["ph_before"]
        self.state.temperature = data["temp_before"]
        self._version += 1

    def commit_effects(self) -> List[UndoToken]:
        reaction_tokens = self._apply_reactions_idempotent()
        self._calculate_ph()
        self._calculate_color()
        self._update_thermal_state()
        self._pending_reactions = []
        self._version += 1
        return reaction_tokens

    def _apply_reactions_idempotent(self) -> List[UndoToken]:
        max_iterations = 10
        all_tokens = []
        for _ in range(max_iterations):
            reaction_fired = False
            reagent_set = {s.reagent for s in self.state.substances if s.moles > MOLES_EPSILON}

            for key, template in REACTION_TEMPLATES.items():
                required = template["reagents"]
                if not required.issubset(reagent_set):
                    continue
                if self._can_reaction_fire(key):
                    token = self._execute_reaction(key)
                    all_tokens.append(token)
                    reaction_fired = True
                    reagent_set = {s.reagent for s in self.state.substances if s.moles > MOLES_EPSILON}

            if not reaction_fired:
                break
        return all_tokens

    def _can_reaction_fire(self, reaction_key: str) -> bool:
        if reaction_key == "acid_base_neutralization":
            return self._get_moles(ReagentType.HCL) > MOLES_EPSILON and self._get_moles(ReagentType.NAOH) > MOLES_EPSILON
        elif reaction_key == "precipitation_cu_oh":
            return self._get_moles(ReagentType.CUSO4) > MOLES_EPSILON and self._get_moles(ReagentType.NAOH_SOLUTION) > MOLES_EPSILON
        elif reaction_key == "precipitation_agcl":
            return self._get_moles(ReagentType.AGNO3) > MOLES_EPSILON and self._get_moles(ReagentType.NACL) > MOLES_EPSILON
        elif reaction_key == "precipitation_baso4":
            return self._get_moles(ReagentType.BACL2) > MOLES_EPSILON and self._get_moles(ReagentType.NA2SO4) > MOLES_EPSILON
        elif reaction_key == "acid_carbonate":
            return self._get_moles(ReagentType.HCL) > MOLES_EPSILON and self._get_moles(ReagentType.CACO3) > MOLES_EPSILON
        elif reaction_key == "fecl3_kscn":
            return self._get_moles(ReagentType.FECL3) > MOLES_EPSILON and self._get_moles(ReagentType.KSCN) > MOLES_EPSILON
        elif reaction_key == "bicarbonate_acid":
            return self._get_moles(ReagentType.HCL) > MOLES_EPSILON and self._get_moles(ReagentType.NABCO3) > MOLES_EPSILON
        return False

    def _execute_reaction(self, reaction_key: str) -> UndoToken:
        template = REACTION_TEMPLATES[reaction_key]
        dedup_key = reaction_key
        already_logged = dedup_key in self._reactions_used_dedup
        if not already_logged:
            self._reactions_used_dedup.add(dedup_key)
            self.state.reactions_log.append(f"⚡ {template['equation']}")

        state_before = self.snapshot()

        if reaction_key == "acid_base_neutralization":
            self._reaction_acid_base()
        elif reaction_key == "precipitation_cu_oh":
            self._reaction_cu_oh()
        elif reaction_key == "precipitation_agcl":
            self._reaction_agcl()
        elif reaction_key == "precipitation_baso4":
            self._reaction_baso4()
        elif reaction_key == "acid_carbonate":
            self._reaction_acid_carbonate()
        elif reaction_key == "fecl3_kscn":
            self._reaction_fecl3_kscn()
        elif reaction_key == "bicarbonate_acid":
            self._reaction_bicarbonate_acid()

        state_after = self.snapshot()

        return UndoToken(
            undo_type=UndoType.REACTION_EFFECT,
            data={
                "reaction_key": reaction_key,
                "state_before": state_before,
                "state_after": state_after,
                "added_log": not already_logged,
                "log_entry": f"⚡ {template['equation']}" if not already_logged else None,
                "dedup_key": dedup_key,
            }
        )

    def _unexecute_reaction(self, token: UndoToken):
        data = token.data
        self.restore(data["state_before"])
        self._version += 1

    def _get_moles(self, rt: ReagentType) -> float:
        return sum(s.moles for s in self.state.substances if s.reagent == rt)

    def _consume_moles(self, rt: ReagentType, moles: float):
        remaining = moles
        for s in self.state.substances:
            if s.reagent == rt and remaining > MOLES_EPSILON:
                consume = min(s.moles, remaining)
                s.moles -= consume
                remaining -= consume

    def _reaction_acid_base(self):
        hcl_moles = self._get_moles(ReagentType.HCL)
        naoh_moles = self._get_moles(ReagentType.NAOH)
        if hcl_moles <= MOLES_EPSILON or naoh_moles <= MOLES_EPSILON:
            return

        reacting = min(hcl_moles, naoh_moles)
        self._consume_moles(ReagentType.HCL, reacting)
        self._consume_moles(ReagentType.NAOH, reacting)
        self.acid_moles = max(0, self.acid_moles - reacting)
        self.base_moles = max(0, self.base_moles - reacting)

        delta_t = reacting * 57.3 / max(self.state.volume_ml / 1000.0, 0.001) / 4186.0 * 1000
        self.state.temperature += min(delta_t, 15)

        self.state.reactions_log.append("🌡️ 放热反应，温度升高")

    def _reaction_cu_oh(self):
        cuso4 = self._get_moles(ReagentType.CUSO4)
        naoh = self._get_moles(ReagentType.NAOH_SOLUTION)
        if cuso4 <= MOLES_EPSILON or naoh <= MOLES_EPSILON:
            return

        reacting = min(cuso4, naoh / 2.0)
        self._consume_moles(ReagentType.CUSO4, reacting)
        self._consume_moles(ReagentType.NAOH_SOLUTION, reacting * 2)
        self.base_moles = max(0, self.base_moles - reacting * 2)

        precip_moles = reacting
        precip_mass = precip_moles * 97.56
        self.state.precipitate_grams += precip_mass
        self.state.precipitate_color = (0.1, 0.3, 0.8)
        self.state.precipitate_name = "Cu(OH)₂"

    def _reaction_agcl(self):
        agno3 = self._get_moles(ReagentType.AGNO3)
        nacl = self._get_moles(ReagentType.NACL)
        if agno3 <= MOLES_EPSILON or nacl <= MOLES_EPSILON:
            return

        reacting = min(agno3, nacl)
        self._consume_moles(ReagentType.AGNO3, reacting)
        self._consume_moles(ReagentType.NACL, reacting)

        precip_mass = reacting * 143.32
        self.state.precipitate_grams += precip_mass
        self.state.precipitate_color = (0.95, 0.95, 0.95)
        self.state.precipitate_name = "AgCl"

    def _reaction_baso4(self):
        bacl2 = self._get_moles(ReagentType.BACL2)
        na2so4 = self._get_moles(ReagentType.NA2SO4)
        if bacl2 <= MOLES_EPSILON or na2so4 <= MOLES_EPSILON:
            return

        reacting = min(bacl2, na2so4)
        self._consume_moles(ReagentType.BACL2, reacting)
        self._consume_moles(ReagentType.NA2SO4, reacting)

        precip_mass = reacting * 233.39
        self.state.precipitate_grams += precip_mass
        self.state.precipitate_color = (1.0, 1.0, 1.0)
        self.state.precipitate_name = "BaSO₄"

    def _reaction_acid_carbonate(self):
        hcl = self._get_moles(ReagentType.HCL)
        caco3 = self._get_moles(ReagentType.CACO3)
        if hcl <= MOLES_EPSILON or caco3 <= MOLES_EPSILON:
            return

        reacting = min(hcl / 2.0, caco3)
        self._consume_moles(ReagentType.HCL, reacting * 2)
        self._consume_moles(ReagentType.CACO3, reacting)
        self.acid_moles = max(0, self.acid_moles - reacting * 2)

        co2_moles = reacting
        co2_volume = co2_moles * 24.0
        self.state.gas_evolved = f"CO₂: {co2_volume:.1f}L"
        self.state.reactions_log.append(f"💨 产生CO₂气体 {co2_volume:.1f}L")

        delta_t = reacting * 17.0 / max(self.state.volume_ml / 1000.0, 0.001) / 4186.0 * 1000
        self.state.temperature += min(delta_t, 10)

    def _reaction_fecl3_kscn(self):
        fecl3 = self._get_moles(ReagentType.FECL3)
        kscn = self._get_moles(ReagentType.KSCN)
        if fecl3 <= MOLES_EPSILON or kscn <= MOLES_EPSILON:
            return

        reacting = min(fecl3, kscn / 3.0)
        self._consume_moles(ReagentType.FECL3, reacting)
        self._consume_moles(ReagentType.KSCN, reacting * 3)

        self._original_colors["fecl3_kscn"] = (tuple(self.state.color), self.state.color_name)
        self.state.color = (0.8, 0.05, 0.05)
        self.state.color_name = "血红色"
        self.state.reactions_log.append("🩸 Fe³⁺特征显色反应：血红色")

    def _reaction_bicarbonate_acid(self):
        hcl = self._get_moles(ReagentType.HCL)
        nahco3 = self._get_moles(ReagentType.NABCO3)
        if hcl <= MOLES_EPSILON or nahco3 <= MOLES_EPSILON:
            return

        reacting = min(hcl, nahco3)
        self._consume_moles(ReagentType.HCL, reacting)
        self._consume_moles(ReagentType.NABCO3, reacting)
        self.acid_moles = max(0, self.acid_moles - reacting)
        self.base_moles = max(0, self.base_moles - reacting)

        co2_moles = reacting
        co2_volume = co2_moles * 24.0
        self.state.gas_evolved = f"CO₂: {co2_volume:.1f}L"
        self.state.reactions_log.append(f"💨 剧烈冒泡，产生CO₂ {co2_volume:.1f}L")

    def undo(self, token: UndoToken):
        for sub_token in reversed(token.sub_tokens):
            self.undo(sub_token)

        undo_type = token.undo_type
        if undo_type == UndoType.ADD_REAGENT:
            if "skipped" in token.data:
                return
            reagent = token.data["reagent"]
            moles = token.data["moles"]
            volume = token.data["volume_ml"]
            self.restore(token.data["state_before"])
        elif undo_type == UndoType.REMOVE_REAGENT:
            if "skipped" in token.data:
                return
            self.restore(token.data["state_before"])
        elif undo_type == UndoType.HEAT:
            self.cool(token)
        elif undo_type == UndoType.STIR:
            self.unstir(token)
        elif undo_type == UndoType.RESET:
            self._unreset(token)
        elif undo_type == UndoType.REACTION_EFFECT:
            self._unexecute_reaction(token)

    def _calculate_ph(self):
        if self.state.volume_ml <= 0:
            self.state.ph = 7.0
            return

        total_volume_l = self.state.volume_ml / 1000.0
        net_acid = self.acid_moles - self.base_moles

        h_concentration = max(net_acid / total_volume_l, 1e-14) if net_acid > 0 else 1e-7
        oh_concentration = max(-net_acid / total_volume_l, 1e-14) if net_acid < 0 else 1e-7

        if net_acid > 0:
            h_concentration = np.clip(h_concentration, 1e-14, 10.0)
            self.state.ph = float(-np.log10(h_concentration))
        elif net_acid < 0:
            oh_concentration = np.clip(oh_concentration, 1e-14, 10.0)
            poh = float(-np.log10(oh_concentration))
            self.state.ph = 14.0 - poh
        else:
            self.state.ph = 7.0

        self.state.ph = float(np.clip(self.state.ph, 0, 14))

        for s in self.state.substances:
            if s.reagent == ReagentType.LITMUS and s.moles > 0:
                if self.state.ph < 5:
                    self.state.color = (0.8, 0.1, 0.1)
                    self.state.color_name = "红色(石蕊)"
                elif self.state.ph > 8:
                    self.state.color = (0.1, 0.1, 0.8)
                    self.state.color_name = "蓝色(石蕊)"
                else:
                    self.state.color = (0.6, 0.2, 0.8)
                    self.state.color_name = "紫色(石蕊)"
                break

        for s in self.state.substances:
            if s.reagent == ReagentType.PHENOLPHTHALEIN and s.moles > 0:
                if self.state.ph > 8.2:
                    self.state.color = (0.9, 0.1, 0.5)
                    self.state.color_name = "粉红色(酚酞)"
                break

    def _calculate_color(self):
        if not self.state.substances:
            self.state.color = (0.9, 0.95, 1.0)
            self.state.color_name = "无色"
            return

        has_fecl3_color = False
        for s in self.state.substances:
            if s.reagent == ReagentType.FECL3 and s.moles > MOLES_EPSILON:
                for s2 in self.state.substances:
                    if s2.reagent == ReagentType.KSCN and s2.moles > MOLES_EPSILON:
                        has_fecl3_color = True
                        break
        if not has_fecl3_color and "fecl3_kscn" in self._original_colors:
            orig_color, orig_name = self._original_colors.pop("fecl3_kscn")
            self.state.color = orig_color
            self.state.color_name = orig_name

        if not has_fecl3_color:
            r, g, b = 0.0, 0.0, 0.0
            total_weight = 0.0

            for s in self.state.substances:
                if s.moles <= MOLES_EPSILON:
                    continue
                props = REAGENT_PROPERTIES[s.reagent]
                weight = s.moles
                cr, cg, cb = props["color"]
                r += cr * weight
                g += cg * weight
                b += cb * weight
                total_weight += weight

            if total_weight > 0:
                r /= total_weight
                g /= total_weight
                b /= total_weight

            if self.state.precipitate_grams > 0:
                pr, pg, pb = self.state.precipitate_color
                precip_factor = min(self.state.precipitate_grams / 5.0, 0.6)
                r = r * (1 - precip_factor) + pr * precip_factor
                g = g * (1 - precip_factor) + pg * precip_factor
                b = b * (1 - precip_factor) + pb * precip_factor

            self.state.color = (float(np.clip(r, 0, 1)), float(np.clip(g, 0, 1)), float(np.clip(b, 0, 1)))

    def _update_thermal_state(self):
        if self.state.temperature < 25.0:
            self.state.temperature += (25.0 - self.state.temperature) * 0.01

        if self.state.is_boiling and self.state.temperature < 100.0:
            self.state.is_boiling = False

    def compare_state(self, other: SolutionState) -> dict:
        diffs = {}
        if abs(self.state.ph - other.ph) > 1e-4:
            diffs["ph"] = (self.state.ph, other.ph)
        if abs(self.state.temperature - other.temperature) > 1e-4:
            diffs["temperature"] = (self.state.temperature, other.temperature)
        if abs(self.state.precipitate_grams - other.precipitate_grams) > 1e-6:
            diffs["precipitate_grams"] = (self.state.precipitate_grams, other.precipitate_grams)
        if abs(self.state.volume_ml - other.volume_ml) > 1e-4:
            diffs["volume_ml"] = (self.state.volume_ml, other.volume_ml)
        if self.state.color_name != other.color_name:
            diffs["color_name"] = (self.state.color_name, other.color_name)
        return diffs


def get_available_reagents() -> list:
    result = []
    for rt, props in REAGENT_PROPERTIES.items():
        result.append({
            "id": rt.value,
            "name": props["name"],
            "color": list(props["color"]),
            "color_name": props["color_name"],
            "concentration": props["concentration"],
            "default_volume": props["default_volume"],
        })
    return result


def get_reaction_templates() -> list:
    result = []
    for key, tmpl in REACTION_TEMPLATES.items():
        result.append({
            "id": key,
            "name": tmpl["name"],
            "equation": tmpl["equation"],
            "description": tmpl["description"],
            "reagents": [r.value for r in tmpl["reagents"]],
        })
    return result
