# Pharma QMS — Complaint Intelligence

An AI-assisted Quality Management System (QMS) tool for pharmaceutical complaint intake. A user pastes complaint text or drops in a document (PDF / DOCX / TXT), an LLM extracts structured fields and generates analytical insights (summary, root cause, CAPA), and the reviewer edits/saves the record with built-in duplicate detection against prior complaints.

## Contents

- [UI Overview](#ui-overview)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Data Model](#data-model)
- [API Reference](#api-reference)
- [Setup](#setup)
- [Environment Variables](#environment-variables)
- [Running the Tests](#running-the-tests)

## UI Overview

Single-page app with a header tab switcher and two main views:

**New Complaint Form** (two-panel layout, each panel scrolls independently — only the inner content scrolls, headers/composers/action bars stay pinned):

- **Left panel — AI Complaint Assistant (chat)**
  - Scrollable message thread (user messages, AI replies, live "extracting..." indicator with animated progress bar).
  - Fixed-position drag-and-drop zone for uploading a `.pdf` / `.docx` / `.doc` / `.txt` file.
  - Fixed-position textarea + "Analyze" button to paste raw complaint text instead of uploading a file.
  - If the AI extraction leaves required fields empty, the assistant asks for them one at a time in the chat, and the next reply is auto-mapped into that field.

- **Right panel — Review & Edit Extracted Details**
  - Completeness meter (0–100%) computed from 5 critical fields (`customer_name`, `product_name`, `batch_number`, `affected_quantity`, `complaint_description`); missing fields are highlighted red on their labels/borders.
  - Scrollable form body organized into sections: Overview & Source, Customer & Product Info, Dates & Quantities, Classification & Triage, Complaint Description, and **AI Insights** (Complaint Summary, Root Cause Recommendation, CAPA Recommendation — auto-filled by the LLM, editable before saving).
  - Inline duplicate-detection results panel (similarity % per match, color-coded by severity).
  - Pinned action bar: Reset, Check Duplicates, Save Complaint Record.
  - A confirmation modal blocks saving when a high-similarity (≥75%) duplicate is found, requiring an explicit "Proceed & Save Anyway".

**Complaint History** — scrollable list of saved records (ref no., product, batch, customer, description snippet, date) with a refresh button and per-record delete.

Built with Tailwind CSS v4 (dark theme, `slate`/`indigo`/`emerald`/`amber`/`rose` palette) and [lucide-react](https://lucide.dev/) icons.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Redux Toolkit + React-Redux, Vite 8, Tailwind CSS 4, lucide-react |
| Backend | FastAPI, Uvicorn, Pydantic v2 |
| AI / Orchestration | LangGraph (single-node extraction graph), LangChain-Groq, Groq `llama-3.3-70b-versatile` |
| Database | SQLAlchemy ORM — SQLite by default, MySQL (`pymysql`) via `DATABASE_URL` |
| Document parsing | PyMuPDF (`fitz`) + `pypdf` fallback for PDF, `python-docx` for Word |
| Duplicate detection | Hand-rolled TF-IDF + cosine similarity (no ML dependency) with an exact batch-number boost |
| Testing | `pytest` + FastAPI `TestClient` against an isolated SQLite test DB |

## Architecture

```
┌─────────────────────┐        POST /api/complaints/analyze         ┌──────────────────────┐
│                      │  ────────────────────────────────────────▶ │                       │
│   React Frontend     │        POST /api/complaints/upload         │   FastAPI Backend     │
│  (Redux Toolkit +    │  ────────────────────────────────────────▶ │   (backend/main.py)   │
│   Vite, port 5173)   │        POST /api/complaints/check-duplicates│                      │
│                      │  ────────────────────────────────────────▶ │                       │
│                      │        POST/GET/DELETE /api/complaints      │                       │
│                      │  ────────────────────────────────────────▶ │                       │
└─────────────────────┘                                              └──────────┬───────────┘
                                                                                 │
                                          ┌──────────────────────────────────────┼─────────────────────┐
                                          ▼                                      ▼                     ▼
                                 LangGraph pipeline                    SQLAlchemy ORM            TF-IDF / cosine
                                 (agent_pipeline.py)                   (models.py, database.py)  similarity (main.py)
                                          │                                      │
                                          ▼                                      ▼
                                 Groq LLM (llama-3.3-70b)              SQLite / MySQL
```

Request flow for a new complaint:

1. User pastes text or uploads a document in the chat panel.
2. For uploads, `extract_text_from_file_bytes()` pulls raw text out of the PDF/DOCX/TXT (PyMuPDF first, `pypdf` as a fallback for PDFs that PyMuPDF can't parse).
3. The raw text is sent to `run_complaint_pipeline()`, a one-node LangGraph graph (`extract_complaint_node`) that prompts the Groq LLM with `COMPLAINT_EXTRACTION_SYSTEM_PROMPT` and parses the returned JSON (fenced in ```json or ``` blocks) into a field dict — including the three generative "AI Insight" fields (`complaint_summary`, `root_cause_recommendation`, `capa_recommendation`), which the LLM is explicitly instructed to infer even when not stated verbatim in the text.
4. The extracted fields are merged into Redux form state (`complaintSlice.js`), any field the LLM returned as `null`/`"Unknown"`/empty is left for the user to fill, and the completeness score / missing-fields list are recalculated.
5. Before saving, the user can trigger duplicate detection: the backend builds a TF-IDF vector for the new complaint (description + product + batch + type, with a stop-word list) and cosine-compares it against every saved complaint, boosting the score to ≥0.85 on an exact batch-number match.
6. On save, the form payload is validated by a Pydantic model and persisted via SQLAlchemy; a unique constraint on `complaint_ref_no` prevents duplicate reference numbers.

## Project Structure

```
Customer Complaint/
├── backend/
│   ├── main.py            # FastAPI app: routes, file-text extraction, TF-IDF duplicate detection
│   ├── agent_pipeline.py   # LangGraph graph wrapping the Groq LLM extraction call
│   ├── prompts.py          # System prompt / JSON schema fed to the LLM
│   ├── models.py           # SQLAlchemy ORM model (ComplaintModel)
│   ├── database.py         # Engine/session setup, DATABASE_URL handling (SQLite default)
│   └── complaints.db       # Default SQLite database file
├── frontend/
│   ├── src/
│   │   ├── App.jsx         # Main UI: tabs, chat panel, form panel, history view, duplicate modal
│   │   ├── config.js       # API_BASE_URL (reads VITE_API_URL, defaults to localhost:8000)
│   │   ├── store/
│   │   │   ├── index.js         # Redux store setup
│   │   │   └── complaintSlice.js # Form state, chat state, async thunks for all API calls
│   │   └── main.jsx, index.css, App.css
│   ├── vite.config.js, tailwind.config.js, postcss.config.js
│   └── package.json
├── test_app.py             # Pytest suite against an isolated SQLite test DB
├── requirements.txt        # Backend (Python) dependencies
├── package.json            # Root-level JS deps (mirrors a subset of frontend's)
└── .env.example            # Template for DATABASE_URL / GROQ_API_KEY
```

## Data Model

`ComplaintModel` (`backend/models.py`), table `complaints`:

| Field | Type | Notes |
|---|---|---|
| `id` | Integer | Primary key, autoincrement |
| `complaint_ref_no` | String(50) | Unique, indexed |
| `complaint_source` | String(50) | e.g. Email, Portal, Phone |
| `customer_name` | String(150) | |
| `product_name` | String(150) | |
| `product_strength` | String(100) | |
| `batch_number` | String(100) | |
| `manufacturing_date`, `expiry_date` | String(50) | |
| `affected_quantity` | String(100) | |
| `originating_block`, `impacted_npm` | String(100) | Internal routing metadata |
| `complaint_type` | String(150) | |
| `complaint_date` | String(50) | |
| `complaint_description` | Text | |
| `initial_severity` | String(50) | Low / Medium / High / Critical |
| `priority` | String(50) | Low / Medium / High / Urgent |
| `risk_assessment` | Text | |
| `complaint_summary` | Text | AI-generated |
| `root_cause_recommendation` | Text | AI-generated |
| `capa_recommendation` | Text | AI-generated |
| `created_at` | DateTime | Defaults to UTC now |

## API Reference

All routes are under `backend/main.py`, mounted at the API root (no prefix).

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/` | Health check |
| `POST` | `/api/complaints/analyze` | Body: `{ raw_text }`. Runs the LLM pipeline on pasted text, returns `extracted_data`. |
| `POST` | `/api/complaints/upload` | Multipart file upload (`.pdf`/`.docx`/`.doc`/`.txt`). Extracts text, then runs the LLM pipeline. Returns `raw_text` + `extracted_data`. |
| `POST` | `/api/complaints/check-duplicates` | Body: description/product/batch/type + optional `top_n`, `threshold`. Returns ranked similarity matches. |
| `POST` | `/api/complaints` | Saves a complaint record. 400 if `complaint_ref_no` already exists. |
| `GET` | `/api/complaints` | Returns all saved complaint records. |
| `DELETE` | `/api/complaints/{id}` | Deletes a complaint record by id. |

## Setup

### Prerequisites

- Python 3.12+
- Node.js 18+
- A [Groq API key](https://console.groq.com/) (free tier works)

### Backend

```bash
python -m venv venv
venv\Scripts\activate          # Windows
pip install -r requirements.txt

copy .env.example .env         # then fill in GROQ_API_KEY (and DATABASE_URL if not using SQLite)

uvicorn backend.main:app --port 8000 --reload
```

### Frontend

```bash
cd frontend
npm install
npm run dev                    # starts Vite dev server on http://localhost:5173
```

The frontend calls the API at `VITE_API_URL` if set, otherwise `http://localhost:8000`.

## Environment Variables

Defined in `.env` at the project root (see `.env.example`):

| Variable | Required | Description |
|---|---|---|
| `GROQ_API_KEY` | Yes | Auth key for the Groq LLM used in extraction/insight generation. |
| `DATABASE_URL` | No | SQLAlchemy connection string. Defaults to a local SQLite file (`backend/complaints.db`) if unset. Supports MySQL via `mysql+pymysql://user:pass@host:3306/dbname`. |
| `VITE_API_URL` | No | Frontend-only (set in `frontend/.env` or shell). Overrides the API base URL; defaults to `http://localhost:8000`. |

## Running the Tests

```bash
pytest
```

`test_app.py` spins up the FastAPI app with `TestClient` against an isolated `test_complaints.db` SQLite file, dropping and recreating tables before each test so runs stay independent of the real database.
