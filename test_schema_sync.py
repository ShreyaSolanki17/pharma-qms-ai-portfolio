import os
import tempfile

from sqlalchemy import create_engine, inspect, text, Column, Integer, String
from sqlalchemy.ext.declarative import declarative_base

from backend.database import sync_missing_columns


def test_sync_missing_columns_heals_drifted_table():
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    engine = create_engine(f"sqlite:///{path}")
    Base = declarative_base()

    class Widget(Base):
        __tablename__ = "widgets"
        id = Column(Integer, primary_key=True)
        name = Column(String(50))
        new_field = Column(String(50))  # not yet in the "existing" table below

    try:
        # Simulate a table created before `new_field` existed on the model.
        with engine.begin() as conn:
            conn.execute(text("CREATE TABLE widgets (id INTEGER PRIMARY KEY, name VARCHAR(50))"))

        sync_missing_columns(base=Base, bind=engine)

        cols = {c["name"] for c in inspect(engine).get_columns("widgets")}
        assert "new_field" in cols
    finally:
        engine.dispose()
        os.remove(path)
