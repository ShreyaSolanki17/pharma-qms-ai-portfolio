from unittest.mock import patch, MagicMock

from langchain_groq import ChatGroq
from backend.agent_pipeline import run_complaint_pipeline


def test_repair_node_recovers_from_malformed_json():
    """extract_complaint_node emits broken JSON -> repair_json_node should fix it."""
    broken = MagicMock(content="not valid json {")
    fixed = MagicMock(content='```json\n{"customer_name": "Jane Doe"}\n```')

    with patch.object(ChatGroq, "invoke", side_effect=[broken, fixed]) as mock_invoke:
        result = run_complaint_pipeline("some complaint text")

    assert result == {"customer_name": "Jane Doe"}
    assert mock_invoke.call_count == 2


def test_valid_json_skips_repair_node():
    valid = MagicMock(content='{"customer_name": "John Smith"}')

    with patch.object(ChatGroq, "invoke", side_effect=[valid]) as mock_invoke:
        result = run_complaint_pipeline("some complaint text")

    assert result == {"customer_name": "John Smith"}
    assert mock_invoke.call_count == 1
