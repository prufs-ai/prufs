# memory.py — Vector + Structured Memory System for ClawdBots
# Uses ChromaDB for semantic memory and SQLite for structured data
# Embeddings generated locally via Ollama (nomic-embed-text) — zero API cost

import chromadb
import sqlite3
import json
import os
from datetime import datetime

try:
    from ollama import Client as OllamaClient
    ollama = OllamaClient()
except Exception:
    ollama = None
    print("⚠  Ollama client not available — memory will run without embeddings")

# ── Paths ──────────────────────────────────────────────────────────────
MEMORY_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "memory")
VECTOR_DB_PATH = os.path.join(MEMORY_DIR, "vector_db")
STRUCTURED_DB_PATH = os.path.join(MEMORY_DIR, "structured.db")

os.makedirs(MEMORY_DIR, exist_ok=True)

# ── Vector Memory (ChromaDB) ──────────────────────────────────────────
chroma = chromadb.PersistentClient(path=VECTOR_DB_PATH)

DOMAINS = [
    "general",
    "coding",
    "travel",
    "eurovan",
    "personal",
    "research",
    "writing",
]

collections = {}
for domain in DOMAINS:
    collections[domain] = chroma.get_or_create_collection(
        name=domain,
        metadata={"hnsw:space": "cosine"}
    )


def _embed(text: str) -> list[float] | None:
    """Generate an embedding locally via Ollama. Returns None if unavailable."""
    if ollama is None:
        return None
    try:
        result = ollama.embeddings(model="nomic-embed-text", prompt=text)
        return result["embedding"]
    except Exception as e:
        print(f"⚠  Embedding failed: {e}")
        return None


def remember(text: str, domain: str = "general", metadata: dict | None = None):
    """Store a memory in the vector database."""
    collection = collections.get(domain, collections["general"])
    embedding = _embed(text)

    meta = {"timestamp": datetime.now().isoformat(), "domain": domain}
    if metadata:
        meta.update(metadata)

    doc_id = f"{domain}_{datetime.now().timestamp()}"

    add_kwargs = {
        "documents": [text],
        "metadatas": [meta],
        "ids": [doc_id],
    }
    if embedding is not None:
        add_kwargs["embeddings"] = [embedding]

    collection.add(**add_kwargs)
    return doc_id


def recall(query: str, domain: str = "general", n_results: int = 5) -> list[str]:
    """Retrieve relevant memories from the vector database."""
    collection = collections.get(domain, collections["general"])
    embedding = _embed(query)

    if collection.count() == 0:
        return []

    query_kwargs = {"n_results": min(n_results, collection.count())}
    if embedding is not None:
        query_kwargs["query_embeddings"] = [embedding]
    else:
        query_kwargs["query_texts"] = [query]

    results = collection.query(**query_kwargs)
    return results["documents"][0] if results["documents"] else []


def forget(doc_id: str, domain: str = "general"):
    """Remove a specific memory by ID."""
    collection = collections.get(domain, collections["general"])
    collection.delete(ids=[doc_id])


def memory_stats() -> dict:
    """Return counts for each memory domain."""
    return {domain: col.count() for domain, col in collections.items()}


# ── Structured Memory (SQLite) ────────────────────────────────────────

def get_db() -> sqlite3.Connection:
    """Get a connection to the structured database."""
    conn = sqlite3.connect(STRUCTURED_DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_structured_db():
    """Create tables for structured data storage."""
    conn = get_db()

    conn.executescript("""
        CREATE TABLE IF NOT EXISTS packing_templates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            mode TEXT NOT NULL,
            duration TEXT,
            season TEXT,
            items TEXT NOT NULL,
            notes TEXT,
            last_updated TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS eurovan_mods (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            system TEXT NOT NULL,
            description TEXT,
            parts TEXT,
            cost_estimate REAL,
            status TEXT DEFAULT 'planned',
            priority TEXT DEFAULT 'medium',
            notes TEXT,
            created TEXT DEFAULT CURRENT_TIMESTAMP,
            last_updated TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            type TEXT,
            status TEXT DEFAULT 'active',
            description TEXT,
            context TEXT,
            created TEXT DEFAULT CURRENT_TIMESTAMP,
            last_updated TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS interaction_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            agent TEXT NOT NULL,
            user_input TEXT,
            response_summary TEXT,
            tokens_used INTEGER,
            model TEXT,
            timestamp TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS preferences (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS experiments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            config TEXT,
            status TEXT DEFAULT 'planned',
            results TEXT,
            notes TEXT,
            created TEXT DEFAULT CURRENT_TIMESTAMP,
            last_updated TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS papers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            authors TEXT,
            venue TEXT,
            year INTEGER,
            summary TEXT,
            relevance TEXT,
            bibtex TEXT,
            notes TEXT,
            added TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS todos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task TEXT NOT NULL,
            category TEXT,
            priority TEXT DEFAULT 'medium',
            due_date TEXT,
            status TEXT DEFAULT 'pending',
            created TEXT DEFAULT CURRENT_TIMESTAMP,
            completed TEXT
        );
    """)

    conn.commit()
    conn.close()


def set_preference(key: str, value: str):
    """Store or update a user preference."""
    conn = get_db()
    conn.execute(
        "INSERT OR REPLACE INTO preferences (key, value, updated) VALUES (?, ?, ?)",
        (key, value, datetime.now().isoformat())
    )
    conn.commit()
    conn.close()


def get_preference(key: str, default: str = "") -> str:
    """Retrieve a user preference."""
    conn = get_db()
    row = conn.execute("SELECT value FROM preferences WHERE key = ?", (key,)).fetchone()
    conn.close()
    return row["value"] if row else default


def log_interaction(agent: str, user_input: str, response_summary: str,
                    tokens_used: int = 0, model: str = ""):
    """Log an agent interaction for self-improvement tracking."""
    conn = get_db()
    conn.execute(
        """INSERT INTO interaction_log (agent, user_input, response_summary, tokens_used, model)
           VALUES (?, ?, ?, ?, ?)""",
        (agent, user_input, response_summary[:500], tokens_used, model)
    )
    conn.commit()
    conn.close()


# ── Initialize on import ──────────────────────────────────────────────
init_structured_db()


if __name__ == "__main__":
    # Quick self-test
    print("Memory system self-test:")
    print(f"  Vector DB path: {VECTOR_DB_PATH}")
    print(f"  Structured DB path: {STRUCTURED_DB_PATH}")
    print(f"  Domains: {DOMAINS}")
    print(f"  Stats: {memory_stats()}")

    # Test remember/recall cycle
    test_id = remember("Wade's 1993 VW Eurovan MV has the 2.5L AAF 5-cylinder engine",
                       domain="eurovan")
    results = recall("What engine does the Eurovan have?", domain="eurovan")
    print(f"  Test recall: {results}")
    forget(test_id, domain="eurovan")
    print("  ✓ Memory system working")
