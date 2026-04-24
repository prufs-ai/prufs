#!/usr/bin/env python3
"""
experiment_tracker.py — SQLite-backed experiment logging and comparison for
CRI fine-tuning experiments in Wade's autoresearch fork.

Usage:
    # As a library (from cri_train.py or cri_eval.py):
    from experiment_tracker import ExperimentTracker
    tracker = ExperimentTracker()
    run_id = tracker.start_run(model="mistral-7b", condition="cri-tuned", ...)
    tracker.log_metric(run_id, "val_bpb", 0.842)
    tracker.log_cri_scores(run_id, correctness=0.78, faithfulness=0.81, ...)
    tracker.end_run(run_id)

    # As a CLI tool:
    python3 experiment_tracker.py list                    # all runs
    python3 experiment_tracker.py compare mistral-7b      # compare conditions for a model
    python3 experiment_tracker.py best correctness         # best run by CRI dimension
    python3 experiment_tracker.py matrix                   # full 3×2×5 results matrix
    python3 experiment_tracker.py export results.csv       # export to CSV
    python3 experiment_tracker.py timeline                 # progress against 14-week plan
"""

import sqlite3
import json
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

DB_PATH = os.environ.get("CRI_TRACKER_DB", "cri_experiments.db")

# ── Schema ──────────────────────────────────────────────────────────────

SCHEMA = """
CREATE TABLE IF NOT EXISTS runs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id          TEXT UNIQUE NOT NULL,
    model           TEXT NOT NULL,          -- mistral-7b, llama-3.1-8b, kimi-k2
    condition       TEXT NOT NULL,          -- base, cri-tuned
    decoding        TEXT NOT NULL,          -- greedy, top-p, top-k, dola, mirostat
    status          TEXT DEFAULT 'running', -- running, completed, failed, aborted
    started_at      TEXT NOT NULL,
    ended_at        TEXT,
    duration_sec    REAL,
    gpu_type        TEXT,                   -- h100, a100, mps-m5
    cloud_cost_usd  REAL,
    notes           TEXT,

    -- QLoRA config (NULL for base condition)
    lora_rank       INTEGER,
    lora_alpha      INTEGER,
    learning_rate   REAL,
    batch_size      INTEGER,
    epochs          INTEGER,
    training_approach TEXT,                 -- sequential, dpo, multitask, curriculum

    -- Autoresearch metrics
    val_bpb         REAL,                   -- validation bits per byte
    train_loss      REAL,
    tokens_per_sec  REAL
);

CREATE TABLE IF NOT EXISTS metrics (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id  TEXT NOT NULL REFERENCES runs(run_id),
    name    TEXT NOT NULL,
    value   REAL NOT NULL,
    step    INTEGER,
    logged_at TEXT NOT NULL,
    UNIQUE(run_id, name, step)
);

CREATE TABLE IF NOT EXISTS cri_scores (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id          TEXT UNIQUE NOT NULL REFERENCES runs(run_id),
    correctness     REAL,       -- 0.0 - 1.0
    faithfulness    REAL,
    stability       REAL,
    constraint_compliance REAL,
    cri_composite   REAL,       -- weighted average
    eval_suite      TEXT,       -- academic, banking, agentforce, full
    eval_details    TEXT,       -- JSON blob with per-benchmark breakdowns
    evaluated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS benchmark_results (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id      TEXT NOT NULL REFERENCES runs(run_id),
    benchmark   TEXT NOT NULL,  -- truthfulqa, factscore, agentbench, swe-bench-lite, etc.
    score       REAL NOT NULL,
    metric_name TEXT NOT NULL,  -- accuracy, precision, pass_rate, etc.
    details     TEXT,           -- JSON blob with per-category breakdowns
    evaluated_at TEXT NOT NULL,
    UNIQUE(run_id, benchmark)
);

CREATE TABLE IF NOT EXISTS notes_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id      TEXT REFERENCES runs(run_id),
    note        TEXT NOT NULL,
    category    TEXT,           -- observation, hypothesis, todo, decision
    created_at  TEXT NOT NULL
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_runs_model ON runs(model);
CREATE INDEX IF NOT EXISTS idx_runs_condition ON runs(condition);
CREATE INDEX IF NOT EXISTS idx_runs_decoding ON runs(decoding);
CREATE INDEX IF NOT EXISTS idx_metrics_run ON metrics(run_id);
CREATE INDEX IF NOT EXISTS idx_cri_run ON cri_scores(run_id);
CREATE INDEX IF NOT EXISTS idx_bench_run ON benchmark_results(run_id);
"""


class ExperimentTracker:
    """SQLite-backed experiment tracker for CRI fine-tuning experiments."""

    def __init__(self, db_path: str = DB_PATH):
        self.db_path = db_path
        self.conn = sqlite3.connect(db_path)
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(SCHEMA)
        self.conn.commit()

    def close(self):
        self.conn.close()

    # ── Run Lifecycle ───────────────────────────────────────────────

    def start_run(
        self,
        model: str,
        condition: str,
        decoding: str,
        gpu_type: str = "h100",
        lora_rank: Optional[int] = None,
        lora_alpha: Optional[int] = None,
        learning_rate: Optional[float] = None,
        batch_size: Optional[int] = None,
        epochs: Optional[int] = None,
        training_approach: Optional[str] = None,
        notes: Optional[str] = None,
    ) -> str:
        """Start a new experiment run. Returns the run_id."""
        now = datetime.utcnow().isoformat()
        run_id = f"{model}_{condition}_{decoding}_{now[:10]}_{now[11:19].replace(':', '')}"

        self.conn.execute(
            """INSERT INTO runs (run_id, model, condition, decoding, started_at,
               gpu_type, lora_rank, lora_alpha, learning_rate, batch_size,
               epochs, training_approach, notes)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (run_id, model, condition, decoding, now, gpu_type,
             lora_rank, lora_alpha, learning_rate, batch_size,
             epochs, training_approach, notes),
        )
        self.conn.commit()
        print(f"  ▶ Started run: {run_id}")
        return run_id

    def end_run(self, run_id: str, status: str = "completed",
                cloud_cost_usd: Optional[float] = None):
        """Mark a run as completed/failed."""
        now = datetime.utcnow().isoformat()
        row = self.conn.execute(
            "SELECT started_at FROM runs WHERE run_id = ?", (run_id,)
        ).fetchone()

        duration = None
        if row:
            start = datetime.fromisoformat(row["started_at"])
            duration = (datetime.utcnow() - start).total_seconds()

        self.conn.execute(
            """UPDATE runs SET status = ?, ended_at = ?, duration_sec = ?,
               cloud_cost_usd = ? WHERE run_id = ?""",
            (status, now, duration, cloud_cost_usd, run_id),
        )
        self.conn.commit()
        print(f"  ■ Ended run: {run_id} ({status}, {duration:.0f}s)" if duration else
              f"  ■ Ended run: {run_id} ({status})")

    # ── Metric Logging ──────────────────────────────────────────────

    def log_metric(self, run_id: str, name: str, value: float,
                   step: Optional[int] = None):
        """Log a single metric value (e.g., val_bpb at step 1000)."""
        now = datetime.utcnow().isoformat()
        self.conn.execute(
            "INSERT OR REPLACE INTO metrics (run_id, name, value, step, logged_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (run_id, name, value, step, now),
        )
        self.conn.commit()

        # Also update summary fields on the run
        if name == "val_bpb":
            self.conn.execute(
                "UPDATE runs SET val_bpb = ? WHERE run_id = ?", (value, run_id)
            )
            self.conn.commit()
        elif name == "train_loss":
            self.conn.execute(
                "UPDATE runs SET train_loss = ? WHERE run_id = ?", (value, run_id)
            )
            self.conn.commit()

    def log_cri_scores(
        self,
        run_id: str,
        correctness: float,
        faithfulness: float,
        stability: float,
        constraint_compliance: float,
        eval_suite: str = "full",
        eval_details: Optional[dict] = None,
        weights: Optional[dict] = None,
    ):
        """Log CRI dimension scores for a run."""
        if weights is None:
            weights = {
                "correctness": 0.30,
                "faithfulness": 0.25,
                "stability": 0.20,
                "constraint_compliance": 0.25,
            }

        composite = (
            correctness * weights["correctness"]
            + faithfulness * weights["faithfulness"]
            + stability * weights["stability"]
            + constraint_compliance * weights["constraint_compliance"]
        )

        now = datetime.utcnow().isoformat()
        self.conn.execute(
            """INSERT OR REPLACE INTO cri_scores
               (run_id, correctness, faithfulness, stability,
                constraint_compliance, cri_composite, eval_suite,
                eval_details, evaluated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (run_id, correctness, faithfulness, stability,
             constraint_compliance, composite, eval_suite,
             json.dumps(eval_details) if eval_details else None, now),
        )
        self.conn.commit()
        print(f"  📊 CRI scores logged: C={correctness:.3f} F={faithfulness:.3f} "
              f"S={stability:.3f} CC={constraint_compliance:.3f} → {composite:.3f}")

    def log_benchmark(self, run_id: str, benchmark: str, score: float,
                      metric_name: str, details: Optional[dict] = None):
        """Log a benchmark result (e.g., TruthfulQA accuracy)."""
        now = datetime.utcnow().isoformat()
        self.conn.execute(
            """INSERT OR REPLACE INTO benchmark_results
               (run_id, benchmark, score, metric_name, details, evaluated_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (run_id, benchmark, score, metric_name,
             json.dumps(details) if details else None, now),
        )
        self.conn.commit()

    def add_note(self, note: str, run_id: Optional[str] = None,
                 category: str = "observation"):
        """Add a research note (optionally tied to a run)."""
        now = datetime.utcnow().isoformat()
        self.conn.execute(
            "INSERT INTO notes_log (run_id, note, category, created_at) "
            "VALUES (?, ?, ?, ?)",
            (run_id, note, category, now),
        )
        self.conn.commit()

    # ── Queries & Comparison ────────────────────────────────────────

    def list_runs(self, model: Optional[str] = None,
                  condition: Optional[str] = None,
                  status: Optional[str] = None,
                  limit: int = 50) -> list:
        """List runs with optional filters."""
        query = "SELECT * FROM runs WHERE 1=1"
        params = []
        if model:
            query += " AND model = ?"
            params.append(model)
        if condition:
            query += " AND condition = ?"
            params.append(condition)
        if status:
            query += " AND status = ?"
            params.append(status)
        query += " ORDER BY started_at DESC LIMIT ?"
        params.append(limit)
        return [dict(r) for r in self.conn.execute(query, params).fetchall()]

    def get_run_with_scores(self, run_id: str) -> Optional[dict]:
        """Get a run with its CRI scores and benchmark results."""
        run = self.conn.execute(
            "SELECT * FROM runs WHERE run_id = ?", (run_id,)
        ).fetchone()
        if not run:
            return None

        result = dict(run)
        cri = self.conn.execute(
            "SELECT * FROM cri_scores WHERE run_id = ?", (run_id,)
        ).fetchone()
        result["cri"] = dict(cri) if cri else None

        benchmarks = self.conn.execute(
            "SELECT * FROM benchmark_results WHERE run_id = ?", (run_id,)
        ).fetchall()
        result["benchmarks"] = [dict(b) for b in benchmarks]

        return result

    def compare_conditions(self, model: str) -> dict:
        """Compare base vs. CRI-tuned for a given model across all decodings."""
        rows = self.conn.execute(
            """SELECT r.model, r.condition, r.decoding, r.val_bpb,
                      c.correctness, c.faithfulness, c.stability,
                      c.constraint_compliance, c.cri_composite
               FROM runs r
               LEFT JOIN cri_scores c ON r.run_id = c.run_id
               WHERE r.model = ? AND r.status = 'completed'
               ORDER BY r.condition, r.decoding""",
            (model,),
        ).fetchall()

        results = {"model": model, "base": {}, "cri-tuned": {}}
        for row in rows:
            r = dict(row)
            cond = r["condition"]
            dec = r["decoding"]
            results[cond][dec] = {
                "val_bpb": r["val_bpb"],
                "correctness": r["correctness"],
                "faithfulness": r["faithfulness"],
                "stability": r["stability"],
                "constraint_compliance": r["constraint_compliance"],
                "cri_composite": r["cri_composite"],
            }
        return results

    def best_by_dimension(self, dimension: str, limit: int = 5) -> list:
        """Find the best runs for a specific CRI dimension."""
        valid = ["correctness", "faithfulness", "stability",
                 "constraint_compliance", "cri_composite"]
        if dimension not in valid:
            raise ValueError(f"dimension must be one of {valid}")

        rows = self.conn.execute(
            f"""SELECT r.run_id, r.model, r.condition, r.decoding,
                       c.{dimension}, c.cri_composite
                FROM runs r
                JOIN cri_scores c ON r.run_id = c.run_id
                WHERE r.status = 'completed'
                ORDER BY c.{dimension} DESC
                LIMIT ?""",
            (limit,),
        ).fetchall()
        return [dict(r) for r in rows]

    def results_matrix(self) -> list:
        """Generate the full 3×2×5 results matrix."""
        rows = self.conn.execute(
            """SELECT r.model, r.condition, r.decoding,
                      r.val_bpb, r.duration_sec, r.cloud_cost_usd,
                      c.correctness, c.faithfulness, c.stability,
                      c.constraint_compliance, c.cri_composite
               FROM runs r
               LEFT JOIN cri_scores c ON r.run_id = c.run_id
               WHERE r.status = 'completed'
               ORDER BY r.model, r.condition, r.decoding"""
        ).fetchall()
        return [dict(r) for r in rows]

    def total_cost(self) -> float:
        """Total cloud GPU spend across all runs."""
        row = self.conn.execute(
            "SELECT COALESCE(SUM(cloud_cost_usd), 0) as total FROM runs"
        ).fetchone()
        return row["total"]

    def total_gpu_hours(self) -> float:
        """Total GPU hours across all runs."""
        row = self.conn.execute(
            "SELECT COALESCE(SUM(duration_sec), 0) / 3600.0 as hours FROM runs "
            "WHERE status = 'completed'"
        ).fetchone()
        return row["hours"]

    def experiment_progress(self) -> dict:
        """Progress against the 30-configuration target."""
        total_target = 30  # 3 models × 2 conditions × 5 decodings

        completed = self.conn.execute(
            "SELECT COUNT(*) as n FROM runs WHERE status = 'completed'"
        ).fetchone()["n"]

        by_model = self.conn.execute(
            """SELECT model, condition,
                      COUNT(*) as completed,
                      5 as target
               FROM runs WHERE status = 'completed'
               GROUP BY model, condition"""
        ).fetchall()

        missing = self.conn.execute(
            """SELECT m.model, m.condition, m.decoding
               FROM (
                   SELECT model, condition, decoding FROM
                   (SELECT 'mistral-7b' as model UNION SELECT 'llama-3.1-8b' UNION SELECT 'kimi-k2')
                   CROSS JOIN (SELECT 'base' as condition UNION SELECT 'cri-tuned')
                   CROSS JOIN (SELECT 'greedy' as decoding UNION SELECT 'top-p'
                               UNION SELECT 'top-k' UNION SELECT 'dola' UNION SELECT 'mirostat')
               ) m
               LEFT JOIN runs r ON m.model = r.model AND m.condition = r.condition
                                   AND m.decoding = r.decoding AND r.status = 'completed'
               WHERE r.run_id IS NULL"""
        ).fetchall()

        return {
            "completed": completed,
            "target": total_target,
            "pct": (completed / total_target * 100) if total_target else 0,
            "by_model": [dict(r) for r in by_model],
            "missing": [dict(r) for r in missing],
            "total_cost_usd": self.total_cost(),
            "total_gpu_hours": self.total_gpu_hours(),
        }

    def export_csv(self, filepath: str):
        """Export the full results matrix to CSV."""
        import csv
        rows = self.results_matrix()
        if not rows:
            print("No completed runs to export.")
            return

        with open(filepath, "w", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=rows[0].keys())
            writer.writeheader()
            writer.writerows(rows)
        print(f"Exported {len(rows)} runs to {filepath}")

    # ── Pretty Printing ─────────────────────────────────────────────

    def print_runs(self, runs: list):
        """Pretty-print a list of runs."""
        if not runs:
            print("  (no runs found)")
            return

        header = f"{'Run ID':<55} {'Model':<15} {'Cond':<10} {'Dec':<10} {'BPB':<8} {'Status':<10}"
        print(header)
        print("─" * len(header))
        for r in runs:
            bpb = f"{r['val_bpb']:.4f}" if r.get("val_bpb") else "—"
            print(f"{r['run_id']:<55} {r['model']:<15} {r['condition']:<10} "
                  f"{r['decoding']:<10} {bpb:<8} {r['status']:<10}")

    def print_comparison(self, model: str):
        """Pretty-print base vs. CRI-tuned comparison for a model."""
        comp = self.compare_conditions(model)
        print(f"\n{'═' * 70}")
        print(f"  {model}: Base vs. CRI-Tuned Comparison")
        print(f"{'═' * 70}")

        header = f"{'Decoding':<12} {'Cond':<10} {'BPB':<8} {'Corr':<8} {'Faith':<8} {'Stab':<8} {'CC':<8} {'CRI':<8}"
        print(header)
        print("─" * len(header))

        for cond in ["base", "cri-tuned"]:
            for dec in ["greedy", "top-p", "top-k", "dola", "mirostat"]:
                if dec in comp.get(cond, {}):
                    d = comp[cond][dec]
                    vals = [f"{d.get(k, 0):.4f}" if d.get(k) is not None else "—    "
                            for k in ["val_bpb", "correctness", "faithfulness",
                                       "stability", "constraint_compliance", "cri_composite"]]
                    print(f"{dec:<12} {cond:<10} {'  '.join(vals)}")
            if cond == "base":
                print("─" * len(header))

    def print_matrix(self):
        """Print the full experiment results matrix."""
        rows = self.results_matrix()
        if not rows:
            print("No completed runs yet.")
            return

        print(f"\n{'═' * 90}")
        print(f"  CRI Experiment Results Matrix")
        print(f"{'═' * 90}")
        header = (f"{'Model':<15} {'Cond':<10} {'Dec':<10} {'BPB':<8} "
                  f"{'Corr':<8} {'Faith':<8} {'Stab':<8} {'CC':<8} {'CRI':<8}")
        print(header)
        print("─" * len(header))

        current_model = None
        for r in rows:
            if r["model"] != current_model:
                if current_model:
                    print("─" * len(header))
                current_model = r["model"]

            vals = []
            for k in ["val_bpb", "correctness", "faithfulness",
                       "stability", "constraint_compliance", "cri_composite"]:
                v = r.get(k)
                vals.append(f"{v:.4f}" if v is not None else "—    ")

            print(f"{r['model']:<15} {r['condition']:<10} {r['decoding']:<10} "
                  f"{'  '.join(vals)}")

    def print_progress(self):
        """Print experiment progress summary."""
        p = self.experiment_progress()
        print(f"\n{'═' * 60}")
        print(f"  CRI Experiment Progress: {p['completed']}/{p['target']} "
              f"({p['pct']:.0f}%)")
        print(f"  GPU hours: {p['total_gpu_hours']:.1f}  |  "
              f"Cloud cost: ${p['total_cost_usd']:.2f}")
        print(f"{'═' * 60}")

        if p["by_model"]:
            print(f"\n  {'Model':<15} {'Condition':<12} {'Done':<6} {'Target':<6}")
            print(f"  {'─' * 45}")
            for r in p["by_model"]:
                print(f"  {r['model']:<15} {r['condition']:<12} "
                      f"{r['completed']:<6} {r['target']:<6}")

        missing_count = len(p["missing"])
        if missing_count > 0 and missing_count <= 10:
            print(f"\n  Remaining configurations ({missing_count}):")
            for m in p["missing"]:
                print(f"    • {m['model']} / {m['condition']} / {m['decoding']}")
        elif missing_count > 10:
            print(f"\n  {missing_count} configurations remaining")


# ── CLI Interface ───────────────────────────────────────────────────────

def cli():
    tracker = ExperimentTracker()

    if len(sys.argv) < 2:
        print("Usage: python3 experiment_tracker.py <command> [args]")
        print()
        print("Commands:")
        print("  list [model]         List all runs (optionally filter by model)")
        print("  compare <model>      Compare base vs CRI-tuned for a model")
        print("  best <dimension>     Best runs by CRI dimension")
        print("  matrix               Full results matrix")
        print("  progress             Experiment progress summary")
        print("  export <file.csv>    Export results to CSV")
        print("  cost                 Total cloud GPU spend")
        print("  note <text>          Add a research note")
        tracker.close()
        return

    cmd = sys.argv[1]

    if cmd == "list":
        model = sys.argv[2] if len(sys.argv) > 2 else None
        runs = tracker.list_runs(model=model)
        tracker.print_runs(runs)

    elif cmd == "compare":
        if len(sys.argv) < 3:
            print("Usage: python3 experiment_tracker.py compare <model>")
            print("  Models: mistral-7b, llama-3.1-8b, kimi-k2")
        else:
            tracker.print_comparison(sys.argv[2])

    elif cmd == "best":
        if len(sys.argv) < 3:
            print("Usage: python3 experiment_tracker.py best <dimension>")
            print("  Dimensions: correctness, faithfulness, stability, "
                  "constraint_compliance, cri_composite")
        else:
            results = tracker.best_by_dimension(sys.argv[2])
            for r in results:
                print(f"  {r[sys.argv[2]]:.4f}  {r['model']:<15} "
                      f"{r['condition']:<10} {r['decoding']}")

    elif cmd == "matrix":
        tracker.print_matrix()

    elif cmd == "progress":
        tracker.print_progress()

    elif cmd == "export":
        if len(sys.argv) < 3:
            print("Usage: python3 experiment_tracker.py export <file.csv>")
        else:
            tracker.export_csv(sys.argv[2])

    elif cmd == "cost":
        cost = tracker.total_cost()
        hours = tracker.total_gpu_hours()
        print(f"  Total cloud cost:  ${cost:.2f}")
        print(f"  Total GPU hours:   {hours:.1f}")

    elif cmd == "note":
        text = " ".join(sys.argv[2:])
        tracker.add_note(text)
        print(f"  ✓ Note saved: {text[:60]}...")

    else:
        print(f"Unknown command: {cmd}")

    tracker.close()


if __name__ == "__main__":
    cli()
