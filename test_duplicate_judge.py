from unittest.mock import patch, MagicMock

from langchain_groq import ChatGroq
from backend.agent_pipeline import judge_duplicates


def test_judge_duplicates_maps_verdicts_by_id():
    response = MagicMock(content='''```json
    [
      {"id": 1, "is_duplicate": true, "reasoning": "Same broken-seal defect on the same batch."},
      {"id": 2, "is_duplicate": false, "reasoning": "Different product, coincidental keyword overlap."}
    ]
    ```''')

    candidates = [
        {"id": 1, "description": "Broken foil seal on batch PT-9042"},
        {"id": 2, "description": "Discoloured tablets in batch AB-1111"},
    ]

    with patch.object(ChatGroq, "invoke", return_value=response):
        verdicts = judge_duplicates("Broken foil seal found on delivery", candidates)

    assert verdicts[1]["is_duplicate"] is True
    assert verdicts[2]["is_duplicate"] is False
    assert "reasoning" in verdicts[1]


def test_judge_duplicates_returns_empty_on_llm_failure():
    with patch.object(ChatGroq, "invoke", side_effect=RuntimeError("groq unavailable")):
        verdicts = judge_duplicates("some complaint", [{"id": 1, "description": "x"}])

    assert verdicts == {}


def test_judge_duplicates_skips_llm_call_when_no_candidates():
    with patch.object(ChatGroq, "invoke") as mock_invoke:
        verdicts = judge_duplicates("some complaint", [])

    assert verdicts == {}
    mock_invoke.assert_not_called()
