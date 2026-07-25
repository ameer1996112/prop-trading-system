from prop_trading.contracts.models import SCHEMA_MODELS as V1_SCHEMA_MODELS
from prop_trading.contracts.rd_entry_vectors_v2 import (
    RDEntryArbitrationVectorsV2,
)
from prop_trading.contracts.rd_strategy_v2 import RDStrategyRuleContractV2

SCHEMA_MODELS = {
    **V1_SCHEMA_MODELS,
    "rd-entry-arbitration-vectors-v2": RDEntryArbitrationVectorsV2,
    "rd-strategy-rule-contract-v2": RDStrategyRuleContractV2,
}
