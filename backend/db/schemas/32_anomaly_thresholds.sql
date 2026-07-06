-- ============================================================
-- Migration 32: Persistent anomaly detection thresholds
--
-- Until now thresholds lived in a Python dict (lost on every backend
-- restart / --reload) and were never read by the scan itself — the
-- Thresholds panel was a placebo. This table makes them durable;
-- api/anomalies.py now reads them at scan time and passes them into
-- the detectors as minimum-deviation floors.
-- ============================================================

CREATE TABLE IF NOT EXISTS anomaly_thresholds (
    connection_id   TEXT PRIMARY KEY REFERENCES connections(id) ON DELETE CASCADE,
    vol_pct         NUMERIC(8,2) NOT NULL DEFAULT 30.0,
    dist_pct        NUMERIC(8,2) NOT NULL DEFAULT 20.0,
    freshness_hours NUMERIC(8,2) NOT NULL DEFAULT 24.0,
    updated_by      VARCHAR(128),
    created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);
