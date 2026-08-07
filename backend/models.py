from sqlalchemy import Column, Integer, String, Text, DateTime
from datetime import datetime
from backend.database import Base

class ComplaintModel(Base):
    __tablename__ = "complaints"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    complaint_ref_no = Column(String(50), unique=True, index=True)

    complaint_source = Column(String(50))
    customer_name = Column(String(150))

    product_name = Column(String(150))
    product_strength = Column(String(100))
    batch_number = Column(String(100))
    manufacturing_date = Column(String(50))
    expiry_date = Column(String(50))
    affected_quantity = Column(String(100))

    originating_block = Column(String(100))
    impacted_npm = Column(String(100))

    complaint_type = Column(String(150))
    complaint_date = Column(String(50))
    complaint_description = Column(Text)

    initial_severity = Column(String(50))
    priority = Column(String(50))
    risk_assessment = Column(Text)

    # LLM-generated, not extracted facts
    complaint_summary = Column(Text)
    root_cause_recommendation = Column(Text)
    capa_recommendation = Column(Text)
    next_action = Column(String(150))

    created_at = Column(DateTime, default=datetime.utcnow)
