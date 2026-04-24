#!/usr/bin/env python3
"""
seed_memories.py — Pre-load ClawdBots memory with Wade's dissertation and project context.
Run once from ~/clawdbots:  python seed_memories.py
"""

from memory import remember, set_preference

print("Seeding ClawdBots memory...\n")

# ── Dissertation Core ─────────────────────────────────────────────────
memories = {
    "research": [
        # Topic and framework
        """Wade's PhD dissertation focuses on token-selection policies and agent reliability,
with a specific focus on the CRI (Correctness, Reliability, and Integrity) framework.
The research spans LLM agent evaluation, hallucination detection, RAG systems, and
multi-agent coordination patterns.""",

        """Wade's CRI framework examines four key dimensions for evaluating agent reliability:
1. Correctness — Are agent outputs factually accurate and logically sound?
2. Faithfulness — Do outputs faithfully represent source material without hallucination?
3. Stability — Are agent behaviors consistent across repeated queries and contexts?
4. Constraint Compliance — Do agents respect domain-specific rules, policies, and guardrails?""",

        """Wade's dissertation has both academic and practical dimensions. The academic side
focuses on LLM agent evaluation methodology and the CRI framework. The practical side
involves banking clients using Salesforce Agentforce deployments in enterprise environments
where compliance and audit trails are critical.""",

        # Status
        """Dissertation status (as of April 2026): Early writing phase. Proposal has been
defended. Committee not yet finalized. Currently building out the literature review
and theoretical framework chapters.""",

        # Academic context
        """Wade is a doctoral student at Walsh College, pursuing a PhD in Computer Science
with a focus on AI. Current courses (Spring 2026, through June 11):
- Applied Research Topics in Deep Learning Theory & Practical Applications (Wednesdays 3:30-5:30 PM PT)
- Doctoral Seminar in Research Methods - RES 711 (Thursdays 3:30-5:30 PM PT)""",

        # Research areas
        """Key research areas for Wade's dissertation literature review:
- Token-selection policies in LLMs (top-k, top-p, temperature effects on reliability)
- LLM agent evaluation frameworks and benchmarks
- Hallucination detection and mitigation in LLMs
- RAG (Retrieval-Augmented Generation) faithfulness and grounding
- Multi-agent coordination patterns and reliability
- Enterprise AI compliance and audit trail requirements
- Agent reliability in high-stakes domains (financial services, healthcare)""",

        # Methodology
        """Wade's research methodology involves:
- Using a fork of Andrej Karpathy's autoresearch GitHub repo for experiments
- Evaluating agent systems across the four CRI dimensions
- Testing in both academic benchmarks and real-world enterprise settings
- Comparing token-selection policies for their impact on agent reliability""",

        # Relevant venues
        """Key academic venues for Wade's research:
- NeurIPS, ICML, ICLR (core ML conferences)
- ACL, EMNLP, NAACL (NLP/language model conferences)
- AAAI, IJCAI (general AI)
- FAccT, AIES (AI ethics and safety — relevant for compliance work)
- ArXiv preprints: cs.LG, cs.AI, cs.CL, cs.SE""",
    ],

    "coding": [
        """Wade's active coding projects:
- ClawdBots: 12-agent orchestrated AI system running on M5 MacBook Air (18GB)
  * Uses Ollama (Mistral) for local routing, Claude API for specialist agents
  * ChromaDB for vector memory, SQLite for structured data
  * 12 agents: Coordinator, Coder, Eurovan Engineer, Trip Planner, Packing List,
    PhD Researcher, AutoResearch Trainer, Memory Curator, Writer, Daily Brief,
    Research Analyst, Life Admin
- Fork of Karpathy's autoresearch repo for ML experiments
- Salesforce Agentforce deployments for banking clients""",

        """Wade's development environment:
- Hardware: M5 MacBook Air, 18GB unified memory
- Local AI: Ollama with Mistral (routing) and nomic-embed-text (embeddings)
- Python 3.12, venv-based projects
- API: Anthropic Claude API (Sonnet for most agents, Opus for complex reasoning)""",
    ],

    "eurovan": [
        """Wade's 1993 VW Eurovan MV current status (as of April 2026):
- Original 2.5L AAF 5-cylinder engine, approximately 185k miles
- No major modifications yet
- Cooling system is still original (HIGH PRIORITY for upgrade)
- CV joints and transmission need inspection
- Used for road trips and camping""",
    ],

    "personal": [
        """Wade's professional context:
- PhD student at Walsh College (CS/AI focus)
- Works with banking clients on Salesforce Agentforce deployments
- Research focus: agent reliability, CRI framework, compliance in financial services
- Active job searcher: looking at Director of AI positions
- Motorcyclist / adventure rider (reads ADVRider, Rider Magazine)
- Family: Suzanne, kids at Golden Bridges School""",

        """Wade's technology interests:
- Local AI / edge computing (Ollama, Apple Silicon optimization)
- Multi-agent systems and orchestration
- Enterprise AI deployment (Salesforce Agentforce)
- VW Eurovan modifications and van life
- Evaluating compute platforms: NVIDIA Jetson, GMKtec mini PCs, Apple Silicon""",
    ],

    "general": [
        """Wade's Salesforce Agentforce work involves deploying AI agents in banking
and financial services environments. Key concerns:
- Compliance with financial regulations
- Audit trail requirements for all agent actions
- Agent reliability when handling sensitive customer data
- Constraint compliance (agents must follow banking policies and procedures)
- This directly feeds into his CRI framework dissertation research""",

        """Wade's scheduled automation system (Cowork):
- AI Daily Brief: 7 AM Mon-Sat (calendar, email, project status)
- Calendar Alerts: Every 4 hours (conflict detection, prep reminders)
- Email Digest: 9 AM Mon-Sat (unread summary, action items)
- Dissertation Research Update: 8 AM Mon/Wed/Sat (papers, experiments, milestones)
- Weekly Self-Improvement: 10 AM Sunday (agent review, memory consolidation)""",
    ],
}

# ── Preferences ───────────────────────────────────────────────────────
preferences = {
    "dissertation_topic": "Token-selection policies and agent reliability — CRI framework",
    "dissertation_stage": "Early writing (April 2026)",
    "school": "Walsh College",
    "degree": "PhD in Computer Science (AI focus)",
    "hardware": "M5 MacBook Air, 18GB unified memory",
    "eurovan_status": "1993 MV, 185k miles, original engine, no major mods, original cooling system",
    "travel_modes": "Eurovan road trip, backpacking, air travel (carry-on preferred)",
    "coding_style": "Simple, readable, complete — no placeholders",
    "writing_tone": "Clear and direct, academic when needed, casual otherwise",
}

# ── Seed it ───────────────────────────────────────────────────────────
count = 0
for domain, entries in memories.items():
    for entry in entries:
        doc_id = remember(entry.strip(), domain=domain, metadata={"source": "seed", "type": "context"})
        count += 1
        print(f"  ✓ [{domain}] {entry.strip()[:70]}...")

print(f"\n  Stored {count} memories across {len(memories)} domains.\n")

for key, value in preferences.items():
    set_preference(key, value)
    print(f"  ✓ Preference: {key} = {value[:60]}...")

print(f"\n  Set {len(preferences)} preferences.")
print("\n✅ Memory seeding complete. ClawdBots now has full context.")
