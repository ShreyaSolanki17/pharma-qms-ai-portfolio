import json
import os
from typing import TypedDict, Dict, Any, List
from langchain_groq import ChatGroq
from langgraph.graph import StateGraph, END
from dotenv import load_dotenv

from .prompts import COMPLAINT_EXTRACTION_SYSTEM_PROMPT, COMPLAINT_UPDATE_SYSTEM_PROMPT

load_dotenv()

groq_api_key = os.getenv("GROQ_API_KEY")
llm = ChatGroq(
    temperature=0,
    model_name="llama-3.3-70b-versatile",
    api_key=groq_api_key,
    max_tokens=900,
    max_retries=1,
    request_timeout=10.0
)

class AgentState(TypedDict):
    raw_text: str
    extracted_data: Dict[str, Any]
    error: str
    raw_response: str


def _parse_json_block(content: str) -> Dict[str, Any]:
    if "```json" in content:
        content = content.split("```json")[1].split("```")[0].strip()
    elif "```" in content:
        content = content.split("```")[1].split("```")[0].strip()
    return json.loads(content)


def extract_complaint_node(state: AgentState) -> AgentState:
    raw_text = state.get("raw_text", "")
    # cap input to stay well under the model's context/token budget
    text_sample = raw_text[:4500] if len(raw_text) > 4500 else raw_text

    prompt = f"""{COMPLAINT_EXTRACTION_SYSTEM_PROMPT}

Complaint Text:
{text_sample}
"""
    try:
        response = llm.invoke(prompt)
        state["raw_response"] = response.content
        state["extracted_data"] = _parse_json_block(response.content)
        state["error"] = ""
    except Exception as e:
        state["error"] = str(e)
        state["extracted_data"] = {}
    return state


def repair_json_node(state: AgentState) -> AgentState:
    # one retry - a malformed reply almost always parses fine on the second try
    repair_prompt = f"""The text below was supposed to be a single valid JSON object but failed to parse (error: {state.get('error')}).

Return ONLY the corrected, valid JSON object. No markdown fences, no commentary, no explanation.

Broken output:
{state.get('raw_response', '')}
"""
    try:
        response = llm.invoke(repair_prompt)
        state["extracted_data"] = _parse_json_block(response.content)
        state["error"] = ""
    except Exception as e:
        state["error"] = str(e)
        state["extracted_data"] = {}
    return state


def _route_after_extract(state: AgentState) -> str:
    # shared by all three graphs below - they all just need to check state["error"]
    return "repair_json" if state.get("error") else END


workflow = StateGraph(AgentState)
workflow.add_node("extract_complaint", extract_complaint_node)
workflow.add_node("repair_json", repair_json_node)
workflow.set_entry_point("extract_complaint")
workflow.add_conditional_edges("extract_complaint", _route_after_extract, {"repair_json": "repair_json", END: END})
workflow.add_edge("repair_json", END)

complaint_app = workflow.compile()

# The Langgraph node responsible for initial raw complaint extraction
def run_complaint_pipeline(raw_text: str) -> Dict[str, Any]:
    initial_state = {"raw_text": raw_text, "extracted_data": {}, "error": "", "raw_response": ""}
    final_state = complaint_app.invoke(initial_state)
    return final_state.get("extracted_data") or {}


class DuplicateJudgeState(TypedDict):
    new_description: str
    candidates: List[Dict[str, Any]]
    verdicts: List[Dict[str, Any]]
    error: str
    raw_response: str

# The Langgraph node for finding duplicates
def judge_duplicates_node(state: DuplicateJudgeState) -> DuplicateJudgeState:
    prompt = f"""You are a QMS duplicate-complaint reviewer for a pharmaceutical manufacturer.

A NEW complaint has been keyword-matched against CANDIDATE complaints already in the system.
For each candidate, decide whether it describes the SAME underlying defect/event as the new
complaint - not just similar wording, but the same actual quality issue. Different products,
different failure modes, or coincidental keyword overlap should be marked false.

Return ONLY a JSON array, one object per candidate, in the same order given:
[{{"id": <candidate id>, "is_duplicate": true or false, "reasoning": "<one short sentence>"}}]

NEW COMPLAINT:
{state["new_description"][:1000]}

CANDIDATES:
{json.dumps(state["candidates"])}
"""
    try:
        response = llm.invoke(prompt)
        state["raw_response"] = response.content
        state["verdicts"] = _parse_json_block(response.content)
        state["error"] = ""
    except Exception as e:
        state["error"] = str(e)
        state["verdicts"] = []
    return state


def repair_duplicate_json_node(state: DuplicateJudgeState) -> DuplicateJudgeState:
    repair_prompt = f"""The text below was supposed to be a single valid JSON array but failed to parse (error: {state.get('error')}).

Return ONLY the corrected, valid JSON array. No markdown fences, no commentary.

Broken output:
{state.get('raw_response', '')}
"""
    try:
        response = llm.invoke(repair_prompt)
        state["verdicts"] = _parse_json_block(response.content)
        state["error"] = ""
    except Exception as e:
        state["error"] = str(e)
        state["verdicts"] = []
    return state


duplicate_workflow = StateGraph(DuplicateJudgeState)
duplicate_workflow.add_node("judge_duplicates", judge_duplicates_node)
duplicate_workflow.add_node("repair_duplicates", repair_duplicate_json_node)
duplicate_workflow.set_entry_point("judge_duplicates")
duplicate_workflow.add_conditional_edges("judge_duplicates", _route_after_extract, {"repair_json": "repair_duplicates", END: END})
duplicate_workflow.add_edge("repair_duplicates", END)

duplicate_judge_app = duplicate_workflow.compile()


def judge_duplicates(new_description: str, candidates: List[Dict[str, Any]]) -> Dict[int, Dict[str, Any]]:
    """Judge TF-IDF-shortlisted candidates (usually <=5) for real duplicates.
    Returns {} on failure so the caller can just fall back to TF-IDF scores.
    """
    if not candidates:
        return {}

    initial_state = {
        "new_description": new_description,
        "candidates": candidates,
        "verdicts": [],
        "error": "",
        "raw_response": "",
    }
    final_state = duplicate_judge_app.invoke(initial_state)
    verdicts = final_state.get("verdicts") or []
    return {v["id"]: v for v in verdicts if "id" in v}


class UpdateState(TypedDict):
    existing_data: Dict[str, Any]
    correction_text: str
    updated_fields: Dict[str, Any]
    error: str
    raw_response: str


def update_complaint_node(state: UpdateState) -> UpdateState:
    prompt = f"""{COMPLAINT_UPDATE_SYSTEM_PROMPT}

EXISTING COMPLAINT DATA:
{json.dumps(state["existing_data"])}

USER'S CORRECTION MESSAGE:
{state["correction_text"]}
"""
    try:
        response = llm.invoke(prompt)
        state["raw_response"] = response.content
        state["updated_fields"] = _parse_json_block(response.content)
        state["error"] = ""
    except Exception as e:
        state["error"] = str(e)
        state["updated_fields"] = {}
    return state


def repair_update_json_node(state: UpdateState) -> UpdateState:
    repair_prompt = f"""The text below was supposed to be a single valid JSON object but failed to parse (error: {state.get('error')}).

Return ONLY the corrected, valid JSON object. No markdown fences, no commentary, no explanation.

Broken output:
{state.get('raw_response', '')}
"""
    try:
        response = llm.invoke(repair_prompt)
        state["updated_fields"] = _parse_json_block(response.content)
        state["error"] = ""
    except Exception as e:
        state["error"] = str(e)
        state["updated_fields"] = {}
    return state


update_workflow = StateGraph(UpdateState)
update_workflow.add_node("update_complaint", update_complaint_node)
update_workflow.add_node("repair_update", repair_update_json_node)
update_workflow.set_entry_point("update_complaint")
update_workflow.add_conditional_edges("update_complaint", _route_after_extract, {"repair_json": "repair_update", END: END})
update_workflow.add_edge("repair_update", END)

update_app = update_workflow.compile()

# Langgraph node for complaint correction through natural language
def run_update_pipeline(existing_data: Dict[str, Any], correction_text: str) -> Dict[str, Any]:
    """Apply a natural-language correction, returning only the fields it changed."""
    initial_state = {
        "existing_data": existing_data,
        "correction_text": correction_text,
        "updated_fields": {},
        "error": "",
        "raw_response": "",
    }
    final_state = update_app.invoke(initial_state)
    return final_state.get("updated_fields") or {}
