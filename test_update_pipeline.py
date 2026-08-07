from unittest.mock import patch, MagicMock

from langchain_groq import ChatGroq
from backend.agent_pipeline import run_update_pipeline


def test_update_pipeline_returns_only_changed_fields():
    response = MagicMock(content='```json\n{"batch_number": "BMX240602", "affected_quantity": "48 capsules"}\n```')

    existing_data = {
        "batch_number": "AMX240602",
        "complaint_description": "Discolored capsules reported.",
        "complaint_summary": "Existing summary that must not be touched.",
    }

    with patch.object(ChatGroq, "invoke", return_value=response):
        updated = run_update_pipeline(existing_data, "Sorry, the batch number is BMX240602 and affected quantity is 48 capsules")

    assert updated == {"batch_number": "BMX240602", "affected_quantity": "48 capsules"}
    assert "complaint_description" not in updated
    assert "complaint_summary" not in updated


def test_update_pipeline_repairs_malformed_json():
    broken = MagicMock(content="not valid json {")
    fixed = MagicMock(content='{"batch_number": "BMX240602"}')

    with patch.object(ChatGroq, "invoke", side_effect=[broken, fixed]) as mock_invoke:
        updated = run_update_pipeline({"batch_number": "AMX240602"}, "batch is BMX240602")

    assert updated == {"batch_number": "BMX240602"}
    assert mock_invoke.call_count == 2


def test_update_pipeline_returns_empty_dict_on_repeated_failure():
    with patch.object(ChatGroq, "invoke", side_effect=RuntimeError("groq unavailable")):
        updated = run_update_pipeline({"batch_number": "AMX240602"}, "batch is BMX240602")

    assert updated == {}
