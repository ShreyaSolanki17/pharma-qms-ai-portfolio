import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.main import app
from backend.database import get_db, Base

# Setup a test database (in-memory SQLite)
SQLALCHEMY_DATABASE_URL = "sqlite:///./test_complaints.db"
engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Create tables in the test database
Base.metadata.create_all(bind=engine)

# Dependency override
def override_get_db():
    try:
        db = TestingSessionLocal()
        yield db
    finally:
        db.close()

app.dependency_overrides[get_db] = override_get_db

client = TestClient(app)

@pytest.fixture(autouse=True)
def setup_db():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield

def test_read_root():
  response = client.get("/")
  assert response.status_code == 200

def test_analyze_complaint():
  response = client.post(
      "/api/complaints/analyze",
      json={
          "raw_text": (
              "Tablet packaging was damaged and a few pills were missing in"
              " batch B123."
          )
      },
  )
  assert response.status_code == 200

def test_save_complaint():
  response = client.post(
      "/api/complaints",
      json={
          "complaint_ref_no": "COMP-2026-001",
          "complaint_source": "Email",
          "customer_name": "John Doe",
          "product_name": "Paracetamol",
          "product_strength": "500mg",
          "batch_number": "B123",
          "manufacturing_date": "2025-01-01",
          "expiry_date": "2027-01-01",
          "affected_quantity": "10 tablets",
          "originating_block": "Block A",
          "impacted_npm": "NPM-01",
          "complaint_type": "Packaging",
          "complaint_date": "2026-03-30",
          "complaint_description": "Damaged blister pack upon arrival.",
          "initial_severity": "Low",
          "priority": "Medium",
          "risk_assessment": "Minimal risk to patient safety.",
      },
  )
  assert response.status_code == 200


def test_upload_complaint_file():
  file_content = b"Customer complaint regarding Paracetamol batch PT-9042 from John Doe."
  files = {"file": ("test_complaint.txt", file_content, "text/plain")}
  response = client.post("/api/complaints/upload", files=files)
  assert response.status_code == 200
  data = response.json()
  assert data["status"] == "success"
  assert "PT-9042" in data["raw_text"]