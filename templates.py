from dataclasses import dataclass
from typing import Any, Dict


@dataclass
class ConfigTemplate:
    name: str
    payload: Dict[str, Any]

    def clone(self) -> Dict[str, Any]:
        import copy
        return copy.deepcopy(self.payload)


BUILTIN_TEMPLATES = [
    ConfigTemplate(
        name="core-income",
        payload={
            "spv": "Core Income Funding I LLC",
            "file_pattern": "Core Income Funding I LLC - Distribution as of \\d{2}\\.\\d{2}\\.\\d{4}\\.xlsx",
            "directory": "\\\\user\\d",
            "fields": {
                "static_values": {"manager": "Core Income Capital"},
                "cell_references": {
                    "global_commitment": {"sheet": "Capital Structure", "cell": "A4"}
                },
                "variables": {
                    "bmo_advances": {"sheet": "Capital Structure", "cell": "B10"},
                    "bmo_commitment": {"sheet": "Capital Structure", "cell": "B5"}
                },
                "calculated_fields": {
                    "bmo_utilization": {
                        "formula": "bmo_advances / bmo_commitment",
                        "description": "Utilization percentage",
                    }
                },
            },
            "data_source": {"type": "filename", "regex": "\\\\d{2}\\\\.\\\\d{2}\\\\.\\\\d{4}"},
        },
    )
]
