from sqlalchemy import create_engine, Column, Integer, Float, Index, String
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

SQLALCHEMY_DATABASE_URL = "sqlite:///./hilbert_index.db"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


class Point(Base):
    __tablename__ = "points"

    id = Column(Integer, primary_key=True, index=True)
    x = Column(Float, nullable=False)
    y = Column(Float, nullable=False)
    hilbert_code_n4 = Column(Integer, nullable=True, index=True)
    hilbert_code_n6 = Column(Integer, nullable=True, index=True)
    hilbert_code_n8 = Column(Integer, nullable=True, index=True)

    __table_args__ = (
        Index('idx_hilbert_n4', 'hilbert_code_n4'),
        Index('idx_hilbert_n6', 'hilbert_code_n6'),
        Index('idx_hilbert_n8', 'hilbert_code_n8'),
        Index('idx_x_y_unique', 'x', 'y', unique=True),
    )


class IndexConfig(Base):
    __tablename__ = "index_config"

    id = Column(Integer, primary_key=True)
    active_n_order = Column(Integer, default=4)
    point_count = Column(Integer, default=0)


class ReindexStatus(Base):
    __tablename__ = "reindex_status"

    id = Column(Integer, primary_key=True)
    is_running = Column(Integer, default=0)
    from_n_order = Column(Integer, nullable=True)
    to_n_order = Column(Integer, nullable=True)
    total_points = Column(Integer, default=0)
    processed_points = Column(Integer, default=0)
    progress_percent = Column(Float, default=0.0)
    dual_write_active = Column(Integer, default=0)
    error_message = Column(String(500), nullable=True)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()

    config = db.query(IndexConfig).first()
    if not config:
        config = IndexConfig(active_n_order=4, point_count=0)
        db.add(config)

    status = db.query(ReindexStatus).first()
    if not status:
        status = ReindexStatus(
            is_running=0,
            from_n_order=None,
            to_n_order=None,
            total_points=0,
            processed_points=0,
            progress_percent=0.0,
            dual_write_active=0
        )
        db.add(status)

    db.commit()
    db.close()
